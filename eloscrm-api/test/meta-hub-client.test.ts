import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/env.js";
import * as hub from "../src/lib/meta-hub/client.js";

afterEach(() => vi.restoreAllMocks());
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const page = (data: unknown[], hasNext: boolean, pageNumber = 1) =>
  response({ data, meta: { total: 0, page: pageNumber, limit: 100, totalPages: 0, hasNext } });
const header = (options: RequestInit | undefined, name: string) => new Headers(options?.headers).get(name);
const rejection = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { return error as hub.HubError; }
  throw new Error("a chamada deveria falhar");
};

describe("cliente do Meta Hub", () => {
  it("usa a URL configurada, o Bearer, timeout e recusa redirect", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ connection: { id: "conn_1" } }));
    await hub.getConnection("conn/1");
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe(`${env.HUB_API_URL}/connections/conn%2F1`);
    expect(options).toMatchObject({ method: "GET", redirect: "error" });
    expect(header(options, "authorization")).toBe(`Bearer ${env.HUB_API_KEY}`);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options).not.toHaveProperty("body");
  });

  it("manda a Idempotency-Key e o corpo JSON no envio", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ message: { id: "msg_1", state: "pending" } }, 202));
    const message = await hub.sendMessage("conn_1", "org:cmd:0", { to: { userId: "BR.1" }, type: "text", text: { body: "oi" } } as hub.HubMessageBody);
    expect(message).toMatchObject({ id: "msg_1" });
    const [, options] = fetch.mock.calls[0];
    expect(options).toMatchObject({ method: "POST" });
    expect(header(options, "idempotency-key")).toBe("org:cmd:0");
    expect(header(options, "content-type")).toBe("application/json");
    expect(JSON.parse(options!.body as string)).toEqual({ to: { userId: "BR.1" }, type: "text", text: { body: "oi" } });
  });

  it("aceita campo desconhecido na resposta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ connection: { id: "conn_1", unknownField: { a: 1 } }, extra: true }));
    expect(await hub.getConnection("conn_1")).toMatchObject({ id: "conn_1", unknownField: { a: 1 } });
  });

  it("429 sem code vira erro com Retry-After e não é incerto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ statusCode: 429, error: "Too Many Requests", message: "Limite" }, 429, { "Retry-After": "7" }));
    const error = await rejection(hub.getConnection("conn_1"));
    expect(error).toBeInstanceOf(hub.HubError);
    expect(error).toMatchObject({ status: 429, code: null, retryAfter: 7, uncertain: false });
  });

  it("4xx traz só o code, sem a mensagem traduzida", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ statusCode: 409, error: "Conflict", code: "IDEMPOTENCY_KEY_REUSED", message: "Chave reutilizada com outro corpo" }, 409));
    const error = await rejection(hub.sendMessage("conn_1", "k", {} as hub.HubMessageBody));
    expect(error).toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED", uncertain: false });
    expect(error.message).not.toContain("Chave reutilizada");
  });

  it("5xx, rede e timeout são incertos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ statusCode: 502, code: "META_UNAVAILABLE" }, 502))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect(await rejection(hub.getConnection("a"))).toMatchObject({ status: 502, code: "META_UNAVAILABLE", uncertain: true });
    expect(await rejection(hub.getConnection("b"))).toMatchObject({ status: null, uncertain: true });
    expect(await rejection(hub.getConnection("c"))).toMatchObject({ status: null, uncertain: true });
  });

  it("2xx com corpo que não é JSON é incerto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await rejection(hub.getConnection("conn_1"))).toMatchObject({ status: 200, uncertain: true });
  });

  it("pagina até hasNext falso com limit 100", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([{ id: "a" }], true))
      .mockResolvedValueOnce(page([{ id: "b" }], false, 2));
    expect((await hub.listConnections("ws_1")).map(item => item.id)).toEqual(["a", "b"]);
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map(url => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(urls.every(url => url.searchParams.get("limit") === "100" && url.searchParams.get("workspaceId") === "ws_1")).toBe(true);
  });

  it("busca o envio pela chave e devolve null quando a lista vem vazia", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page([{ id: "msg_1" }], false)).mockResolvedValueOnce(page([], false));
    expect(await hub.findMessageByKey("conn_1", "org:cmd:0")).toMatchObject({ id: "msg_1" });
    expect(await hub.findMessageByKey("conn_1", "org:cmd:0")).toBeNull();
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("idempotencyKey")).toBe("org:cmd:0");
  });

  it("sobe mídia com o corpo cru, o MIME e o nome do arquivo", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ media: { id: "med_1" } }, 201));
    await hub.uploadMedia("conn_1", { body: Buffer.from("abc"), contentType: "image/png", filename: "foto.png" });
    const [, options] = fetch.mock.calls[0];
    expect(options).toMatchObject({ method: "POST" });
    expect(header(options, "content-type")).toBe("image/png");
    expect(header(options, "x-filename")).toBe("foto.png");
    expect(Buffer.from(options!.body as Uint8Array).toString()).toBe("abc");
  });

  it("nome de arquivo fora de Latin-1 ou com quebra de linha é trocado, não derruba o envio", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response({ media: { id: "med_1" } }, 201));
    await hub.uploadMedia("conn_1", { body: Buffer.from("abc"), contentType: "application/pdf", filename: "rel\u20142026\nfinal.pdf" });
    expect(header(fetch.mock.calls[0][1], "x-filename")).toBe("rel_2026_final.pdf");
    await hub.uploadMedia("conn_1", { body: Buffer.from("abc"), contentType: "application/pdf", filename: "Imóvel.pdf" });
    expect(header(fetch.mock.calls[1][1], "x-filename")).toBe("Imóvel.pdf");
  });

  it("id vazio, '.' ou '..' é recusado antes de qualquer chamada", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const id of ["", ".", ".."]) expect(() => hub.getConnection(id)).toThrow(hub.HubError);
    expect(() => hub.getTemplate("conn_1", "..")).toThrow(hub.HubError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lista os templates com o syncedAt da conta e recusa leitura que atravessou uma sincronização", async () => {
    const tplPage = (data: unknown[], hasNext: boolean, syncedAt: string | null) =>
      response({ data, meta: { total: 0, page: 1, limit: 100, totalPages: 0, hasNext }, syncedAt });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tplPage([{ id: "t1" }], true, "2026-11-12T10:00:00.000Z"))
      .mockResolvedValueOnce(tplPage([{ id: "t2" }], false, "2026-11-12T10:00:00.000Z"))
      .mockResolvedValueOnce(tplPage([{ id: "t1" }], true, "2026-11-12T10:00:00.000Z"))
      .mockResolvedValueOnce(tplPage([{ id: "t2" }], false, "2026-11-12T10:05:00.000Z"));
    const first = await hub.listTemplates("conn_1");
    expect(first.items.map(item => item.id)).toEqual(["t1", "t2"]);
    expect(first.syncedAt).toBe("2026-11-12T10:00:00.000Z");
    expect(await rejection(hub.listTemplates("conn_1"))).toMatchObject({ code: "HUB_TEMPLATES_RESYNCED", uncertain: false });
  });

  it("DELETE com 204 resolve sem corpo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(hub.deleteTemplate("conn_1", "tpl_1")).resolves.toBeUndefined();
  });
});
