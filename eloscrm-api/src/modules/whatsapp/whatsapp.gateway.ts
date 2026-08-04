import { env } from "../../env.js";
import { httpError } from "../../lib/http-error.js";
import { decryptToken } from "../../lib/crypto.js";
import { debugLog } from "../../lib/debug-log.js";
import { createUazapiClient, type UazapiClient, type UazapiTraceEntry } from "../../lib/uazapi/index.js";
import type { UazapiErrorPayload } from "../../lib/uazapi/types.js";

// A lib não conhece arquivo nem env — recebe o tracer e chama. Mantém o cliente HTTP reutilizável e
// o diagnóstico como decisão desta aplicação.
const onTrace = (entry: UazapiTraceEntry) => debugLog("uazapi", { ...entry });

export type IntegrationConfig = {
  baseUrl: string;
  adminToken: string;
  publicApiUrl: string;
};

/**
 * As envs da uazapi são opcionais para dev/teste/CI subirem sem credencial. Quem precisa delas
 * chama isto e recebe 503 quando falta alguma — nunca um TypeError lá dentro.
 */
export const requireIntegration = (): IntegrationConfig => {
  if (!env.UAZAPI_BASE_URL || !env.UAZAPI_ADMIN_TOKEN || !env.UAZAPI_TOKEN_ENCRYPTION_KEY) {
    throw httpError(
      503,
      "INTEGRATION_NOT_CONFIGURED",
      "Integração com WhatsApp não configurada neste ambiente",
    );
  }
  return {
    baseUrl: env.UAZAPI_BASE_URL,
    adminToken: env.UAZAPI_ADMIN_TOKEN,
    // Em produção BETTER_AUTH_URL já é público; em dev é localhost e a uazapi não alcança —
    // ali é preciso um túnel apontado em PUBLIC_API_URL, senão o webhook nunca chega.
    publicApiUrl: (env.PUBLIC_API_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, ""),
  };
};

export const adminClient = (config: IntegrationConfig): UazapiClient =>
  createUazapiClient({ baseURL: config.baseUrl, adminToken: config.adminToken, onTrace });

/** Só para o token recém-criado, que ainda não passou pelo banco. Fora disso use instanceClient. */
export const tokenClient = (config: IntegrationConfig, token: string): UazapiClient =>
  createUazapiClient({ baseURL: config.baseUrl, token, onTrace });

export const instanceClient = (config: IntegrationConfig, tokenEnc: string): UazapiClient => {
  let token: string;
  try {
    token = decryptToken(tokenEnc);
  } catch {
    // chave de cifra trocada ou registro corrompido: não há como falar com a instância de novo
    throw httpError(
      500,
      "INSTANCE_TOKEN_CORRUPTED",
      "Não foi possível ler o token da instância. Remova e conecte o WhatsApp novamente.",
    );
  }
  return createUazapiClient({ baseURL: config.baseUrl, token, onTrace });
};

export const webhookUrl = (config: IntegrationConfig, instanceId: string, secret: string) =>
  `${config.publicApiUrl}/webhooks/uazapi/${instanceId}/${secret}`;

/** A URL registrada na uazapi carrega o segredo no último segmento; nunca devolvê-la inteira. */
export const maskWebhookUrl = (url: string) => url.replace(/\/[^/]+$/, "/••••");

/**
 * A instância sumiu do provedor (apagada no painel, token revogado). Vale a pena distinguir de uma
 * falha comum: o único caminho de saída é remover o registro local e reconectar.
 */
export const isInstanceGone = (err: UazapiErrorPayload) => {
  if (err.status === 401) return true;
  const msg = `${err.error ?? ""} ${err.message_ptbr ?? ""}`.toLowerCase();
  return msg.includes("invalid token") || msg.includes("instance not found");
};

export const uazapiError = (err: UazapiErrorPayload) => {
  const message = err.message_ptbr ?? err.error ?? "Erro na integração com o WhatsApp";
  if (err.error_source === "network" || err.error_source === "timeout") {
    return httpError(504, "UAZAPI_UNAVAILABLE", "O servidor de WhatsApp não respondeu");
  }
  // 503 do /instance/connect é capacidade temporária, não falha: a uazapi manda Retry-After
  if (err.status === 503) {
    const retryAfter = (err.raw as { retry_after?: number } | undefined)?.retry_after;
    return httpError(503, "UAZAPI_CAPACITY", message, retryAfter ? { retryAfter } : undefined);
  }
  return httpError(502, "UAZAPI_ERROR", message);
};
