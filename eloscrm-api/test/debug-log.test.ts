import { describe, it, expect } from "vitest";
import { redact, debugLogEnabled, safeHeaders } from "../src/lib/debug-log.js";
import { createUazapiClient, type UazapiTraceEntry } from "../src/lib/uazapi/index.js";

describe("debug-log", () => {
  it("fica desligado quando UAZAPI_DEBUG_LOG não está no ambiente", () => {
    // se isto falhar, a suíte está escrevendo arquivo de diagnóstico a cada run
    expect(debugLogEnabled()).toBe(false);
  });

  it("redige o valor do token mas mantém a chave — é a chave que revela o formato", () => {
    const out = redact({ EventType: "connection", token: "abc123def456" }) as Record<string, unknown>;
    expect(out).toHaveProperty("token");
    expect(out.token).toBe("<redigido len=12>");
    expect(out.EventType).toBe("connection");
  });

  it("redige o token aninhado no payload da instância", () => {
    const out = redact({ instance: { status: "connected", token: "segredo" } }) as {
      instance: Record<string, unknown>;
    };
    expect(out.instance.status).toBe("connected");
    expect(out.instance.token).toBe("<redigido len=7>");
  });

  it("redige o último segmento da URL de webhook, que é o segredo", () => {
    const out = redact({
      url: "https://api.exemplo.com/webhooks/uazapi/inst-1/SEGREDO-DE-32-BYTES",
    }) as Record<string, string>;
    expect(out.url).toBe("https://api.exemplo.com/webhooks/uazapi/inst-1/<redigido>");
  });

  it("não mexe em URL que não seja de webhook", () => {
    const url = "https://free.uazapi.com/instance/connect";
    expect((redact({ url }) as Record<string, string>).url).toBe(url);
  });

  it("omite o valor de header não inócuo, mas mantém o nome", () => {
    const out = safeHeaders({
      "content-type": "application/json",
      authorization: "Bearer super-secreto",
      cookie: "sess=abc",
      "x-api-key": "chave",
      "x-uazapi-signature": "assinatura",
    });
    expect(out["content-type"]).toBe("application/json");
    // o nome aparece — é assim que se descobre que a uazapi passou a mandar um header novo
    expect(out).toHaveProperty("x-uazapi-signature");
    for (const key of ["authorization", "cookie", "x-api-key", "x-uazapi-signature"]) {
      expect(out[key]).toBe("<omitido>");
    }
  });

  it("nenhum header sensível conhecido escapa por diferença de caixa", () => {
    const out = safeHeaders({ Authorization: "Bearer x", Cookie: "s=1" });
    expect(Object.values(out)).toEqual(["<omitido>", "<omitido>"]);
  });

  it("percorre arrays e preserva escalares", () => {
    const out = redact([{ token: "a" }, { name: "ok" }, 42, null]) as unknown[];
    expect(out).toEqual([{ token: "<redigido len=1>" }, { name: "ok" }, 42, null]);
  });
});

describe("trace de saída do client uazapi", () => {
  it("registra a requisição e o erro quando o servidor não responde", async () => {
    const entries: UazapiTraceEntry[] = [];
    // porta fechada em localhost: falha rápido e não toca em serviço externo
    const client = createUazapiClient({
      baseURL: "http://127.0.0.1:1",
      token: "tok-teste",
      timeoutMs: 2000,
      onTrace: (entry) => entries.push(entry),
    });

    const result = await client.instance.status();
    expect(result.success).toBe(false);

    const request = entries.find((e) => e.direction === "request");
    expect(request).toMatchObject({ method: "GET", path: "/instance/status" });
    expect(entries.some((e) => e.direction === "error")).toBe(true);
  });

  it("sem onTrace o cliente não coleta nada (o padrão é desligado)", async () => {
    const client = createUazapiClient({ baseURL: "http://127.0.0.1:1", token: "t", timeoutMs: 2000 });
    // só precisa não estourar: sem interceptor registrado, o Result continua normalizando o erro
    const result = await client.instance.status();
    expect(result.success).toBe(false);
  });
});
