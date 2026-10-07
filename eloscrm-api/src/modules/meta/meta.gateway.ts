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
 * gestor digitou, não do servidor. Sem privilégio na página é 403; as demais falhas são 502/504.
 */
export const metaError = (err: unknown, page?: { pageId: string; name: string }) => {
  if (!(err instanceof MetaGraphError)) return err;
  if (err.network) return httpError(504, "META_UNAVAILABLE", "O Meta não respondeu");
  if (err.tokenInvalid) {
    return httpError(
      422,
      "META_TOKEN_INVALID",
      "O Meta recusou este token. Gere um novo e tente de novo.",
    );
  }
  if (page && (err.graph?.code === 10 || err.graph?.code === 200)) {
    return httpError(
      403,
      "META_PAGE_ACCESS_DENIED",
      `O Meta recusou o acesso aos formulários da página "${page.name}" (ID ${page.pageId}). Confira os ativos atribuídos ao usuário do sistema, as permissões do token e o Acesso a leads no portfólio que controla a página.`,
    );
  }
  return httpError(502, "META_ERROR", `Erro do Meta: ${err.graph?.message ?? "sem detalhe"}`);
};
