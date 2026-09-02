import { env } from "../../env.js";
import { httpError } from "../../lib/http-error.js";
import { MetaGraphError } from "../../lib/meta/index.js";

/** Sem a chave de cifra não há como guardar o token: mesma regra da integração de WhatsApp. */
export const requireIntegrationEnv = () => {
  if (!env.UAZAPI_TOKEN_ENCRYPTION_KEY) {
    throw httpError(
      503,
      "INTEGRATION_NOT_CONFIGURED",
      "Integração com o Meta não configurada neste ambiente",
    );
  }
};

/**
 * Traduz a falha da Graph API para o envelope da API. Token recusado é 422 — é erro do dado que o
 * gestor digitou, não do servidor; o resto é 502/504 exposto, como os erros da uazapi.
 */
export const metaError = (err: unknown) => {
  if (!(err instanceof MetaGraphError)) return err;
  if (err.network) return httpError(504, "META_UNAVAILABLE", "O Meta não respondeu");
  if (err.tokenInvalid) {
    return httpError(
      422,
      "META_TOKEN_INVALID",
      "O Meta recusou este token. Gere um novo e tente de novo.",
    );
  }
  return httpError(502, "META_ERROR", `Erro do Meta: ${err.graph?.message ?? "sem detalhe"}`);
};
