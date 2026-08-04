import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env.js";

/**
 * Trilha de diagnóstico em JSONL para a integração de WhatsApp: registra o que sai para a uazapi e
 * o que chega dela, incluindo o corpo cru dos webhooks. Existe para responder a uma pergunta que a
 * spec da uazapi não responde — qual é o formato real do envelope entregue (ver
 * `docs/superpowers/specs/2026-08-03-whatsapp-uazapi-design.md`, §5.1).
 *
 * Desligado por padrão: sem `UAZAPI_DEBUG_LOG` no ambiente, tudo aqui é no-op. Não é o logger da
 * aplicação — é ferramenta de diagnóstico, para ligar enquanto se investiga e desligar depois.
 */

// Valores destas chaves nunca vão para o arquivo. As chaves em si vão — é o nome do campo que
// revela o formato do envelope, e é justamente isso que estamos tentando descobrir.
const SECRET_KEYS = new Set(["token", "admintoken", "apikey", "openai_apikey", "webhooksecret"]);

const redactValue = (value: unknown) =>
  typeof value === "string" ? `<redigido len=${value.length}>` : "<redigido>";

// A URL do webhook termina no segredo de 32 bytes; quem lê o arquivo precisa saber que a URL veio,
// não qual é o segredo.
const redactUrl = (value: string) =>
  value.includes("/webhooks/uazapi/") ? value.replace(/\/[^/]+$/, "/<redigido>") : value;

export const redact = (value: unknown): unknown => {
  if (typeof value === "string") return redactUrl(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? redactValue(v) : redact(v);
    }
    return out;
  }
  return value;
};

// Headers vão por allowlist de VALOR, não por blocklist: uma lista de proibidos sempre esquece um
// (`authorization`, `cookie`, `x-api-key`, `proxy-authorization`…) e o custo do esquecimento é
// credencial em claro no disco. Os **nomes** de todos os headers continuam visíveis — se a uazapi
// passar a mandar um header próprio (uma assinatura, por exemplo), ele aparece sem o valor vazar.
const HEADER_VALUES_OK = new Set(["host", "accept", "content-type", "content-length", "user-agent"]);

export const safeHeaders = (headers: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = HEADER_VALUES_OK.has(key.toLowerCase()) ? value : "<omitido>";
  }
  return out;
};

let stream: WriteStream | null = null;
let failed = false;

const target = () => {
  if (failed || !env.UAZAPI_DEBUG_LOG) return null;
  if (!stream) {
    try {
      mkdirSync(dirname(env.UAZAPI_DEBUG_LOG), { recursive: true });
      stream = createWriteStream(env.UAZAPI_DEBUG_LOG, { flags: "a" });
      // disco cheio ou caminho inválido não pode derrubar o processo por causa de diagnóstico
      stream.on("error", () => {
        failed = true;
        stream = null;
      });
    } catch {
      failed = true;
      return null;
    }
  }
  return stream;
};

export const debugLog = (kind: string, data: Record<string, unknown>) => {
  const out = target();
  if (!out) return;
  out.write(`${JSON.stringify({ at: new Date().toISOString(), kind, ...(redact(data) as object) })}\n`);
};

export const debugLogEnabled = () => Boolean(env.UAZAPI_DEBUG_LOG);
