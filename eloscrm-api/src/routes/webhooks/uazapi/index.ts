import type { FastifyInstance } from "fastify";
import { webhookBodySchema, webhookParamsSchema } from "../../../modules/whatsapp/whatsapp.schema.js";
import * as webhook from "../../../modules/whatsapp/whatsapp.webhook.service.js";

/**
 * Receptor de eventos da uazapi. **Sem authGuard/orgGuard de propósito** — quem chama é o servidor
 * da uazapi, que não tem sessão nem cookie. Não é a exceção descuidada que o CLAUDE.md alerta: a
 * autenticação está em `webhook.authenticate`, pelo par (segredo na URL, hash do token no corpo),
 * ambos comparados em tempo constante. Rota nova aqui dentro precisa chamar `authenticate` também.
 *
 * Fica fora de /v1 porque não é API de domínio: o contrato é com o provedor, não com o nosso front.
 */
const uazapiWebhookRoutes = async (app: FastifyInstance) => {
  app.post("/:instanceId/:secret", async (request) => {
    const { instanceId, secret } = webhookParamsSchema.parse(request.params);
    const body = webhookBodySchema.parse(request.body);

    const instance = await webhook.authenticate(instanceId, secret, body.token);
    const result = await webhook.process(instance, body, new Date());

    // O envelope da uazapi não está na spec (ver webhookBodySchema). Se um dia chegar num formato
    // que não reconhecemos, o sintoma seria a conexão parar de atualizar sozinha — silencioso
    // demais. Este warn é o que faz o problema aparecer no log da API, e não só na uazapi.
    if (!result.event) {
      request.log.warn({ instanceId, keys: Object.keys(body) }, "webhook uazapi: envelope sem evento");
    }

    return { received: true };
  });
};

export default uazapiWebhookRoutes;
