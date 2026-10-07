import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as graph from "../src/lib/whatsapp-official/graph.js";

afterEach(() => vi.restoreAllMocks());
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("cliente oficial da Graph API", () => {
  it("envia token no header, usa timeout e recusa redirects", async () => {
    const token = randomBytes(24).toString("base64url");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ request_id: "fictitious-request" }));
    await graph.requestSync(token, "123", "history");
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123\/smb_app_data$/);
    expect(String(url)).not.toContain(token);
    expect(options).toMatchObject({ redirect: "error", method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options!.body as string)).toEqual({ messaging_product: "whatsapp", sync_type: "history" });
  });

  it("pagina por cursor no host fixo sem seguir next externo", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ data: [], paging: { next: "http://169.254.169.254/secret", cursors: { after: "next-cursor" } } }))
      .mockResolvedValueOnce(response({ data: [] }));
    expect(await graph.readPhones(randomBytes(24).toString("base64url"), "123")).toHaveLength(2);
    expect(String(fetch.mock.calls[1][0])).toContain("graph.facebook.com/");
    expect(String(fetch.mock.calls[1][0])).toContain("after=next-cursor");
    expect(String(fetch.mock.calls[1][0])).not.toContain("169.254");
  });

  it("não propaga mensagem privada do provider em erros", async () => {
    const secret = randomBytes(24).toString("base64url");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ error: { code: 190, message: secret } }, 400));
    let failure: unknown;
    try { await graph.requestSync(secret, "123", "history"); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 190, uncertain: false });
    expect(String(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it("classifica rede, 5xx e resposta inválida como resultado incerto", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Erro privado"))
      .mockResolvedValueOnce(response({ error: { code: 1 } }, 503)).mockResolvedValueOnce(new Response("HTML inválido", { status: 200 }));
    for (let index = 0; index < 3; index++) await expect(graph.requestSync(randomBytes(24).toString("base64url"), "123", "history")).rejects.toMatchObject({ uncertain: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("pagina templates no endpoint da WABA sem usar a URL next", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ data: [{ id: "11" }], paging: { next: "http://127.0.0.1/private", cursors: { after: "template-cursor" } } }))
      .mockResolvedValueOnce(response({ data: [{ id: "12" }] }));
    expect(await graph.readTemplates(randomBytes(24).toString("base64url"), "123", "appointment_notice")).toEqual([{ id: "11" }, { id: "12" }]);
    const url = new URL(String(fetch.mock.calls[1][0]));
    expect(url.hostname).toBe("graph.facebook.com");
    expect(url.pathname).toMatch(/\/123\/message_templates$/);
    expect(url.searchParams.get("after")).toBe("template-cursor");
    expect(url.searchParams.get("name")).toBe("appointment_notice");
  });
  it("mídia usa multipart com Bearer e envio usa o endpoint messages", async () => {
    const token = randomBytes(24).toString("base64url");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ id: "12345" })).mockResolvedValueOnce(response({ messages: [{ id: "wamid.fixture" }] }));
    expect(await graph.uploadMedia(token, "123", Buffer.from("%PDF-fixture"), "application/pdf", "fixture.pdf")).toBe("12345");
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/123\/media$/);
    expect(String(url)).not.toContain(token);
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}` } });
    const body = options!.body as FormData;
    expect(body.get("messaging_product")).toBe("whatsapp");
    expect(body.get("type")).toBe("application/pdf");
    expect(body.get("file")).toBeInstanceOf(Blob);
    await graph.sendMessage(token, "123", { messaging_product: "whatsapp", type: "text", text: { body: "Mensagem fictícia" } });
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/123\/messages$/);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toHaveProperty("text.body", "Mensagem fictícia");
  });
});

it("cria e exclui templates por ID sem colocar token na URL", async () => {
  const token = randomBytes(24).toString("base64url");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ id: "789", status: "PENDING" })).mockResolvedValueOnce(response({ success: true }));
  await graph.createTemplate(token, "123", { name: "visita", language: "pt_BR", category: "UTILITY", components: [{ type: "BODY", text: "Olá" }] });
  expect(fetch.mock.calls[0][1]?.method).toBe("POST");
  await graph.deleteTemplate(token, "123", "789", "visita");
  expect(fetch.mock.calls[1][1]?.method).toBe("DELETE");
  const url = new URL(String(fetch.mock.calls[1][0]));
  expect(url.searchParams.get("hsm_id")).toBe("789");
  expect(url.searchParams.get("name")).toBe("visita");
  expect(String(url)).not.toContain(token);
});
