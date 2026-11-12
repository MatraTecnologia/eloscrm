import type { FastifyInstance } from "fastify";
import { env } from "../../../env.js";
import { httpError } from "../../../lib/http-error.js";
import { queueEnabled } from "../../../lib/queue.js";
import { authenticateHubWebhook } from "../../../lib/meta-hub/webhook-auth.js";
import { capture } from "../../../modules/meta-hub/webhook.repo.js";
import { hubEnvelopeSchema } from "../../../modules/meta-hub/webhook.schema.js";
import { dispatchDueEvents } from "../../../modules/meta-hub/webhook.service.js";

// Sem guards: quem chama é o hub, sem cookie. A autenticação é a assinatura HMAC (§5.2 do plano).
const metaHubWebhookRoutes = async (app: FastifyInstance) => {
  // sem o segredo a rota não existe: nada aqui aceita evento sem assinatura conferível
  if (!env.HUB_WEBHOOK_SECRET) return;
  // Parser encapsulado: o HMAC usa os bytes originais; as outras rotas continuam recebendo JSON.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const requests = new Map<string, { startedAt: number; count: number }>();
  app.addHook("onRequest", async request => {
    // atrás do Traefik o request.ip é o do proxy para todo mundo, e um balde único deixaria qualquer
    // terceiro levar as entregas do hub a 429; x-real-ip é o header que o Traefik grava (src/lib/auth.ts)
    const realIp = request.headers["x-real-ip"];
    const key = typeof realIp === "string" && realIp ? realIp : request.ip;
    const now = Date.now();
    const bucket = requests.get(key);
    if (!bucket || now - bucket.startedAt >= 1000) {
      if (requests.size >= 2000) requests.clear();
      requests.set(key, { startedAt: now, count: 1 });
    } else if (++bucket.count > 200) throw httpError(429, "WEBHOOK_RATE_LIMIT", "Limite de recebimento excedido; tente novamente");
  });

  // logLevel silent: o corpo traz mensagens e telefones, e os headers, a assinatura
  app.post("/", { logLevel: "silent", bodyLimit: 16 * 1024 * 1024 }, async request => {
    if (!Buffer.isBuffer(request.body)) throw httpError(415, "WEBHOOK_CONTENT_TYPE", "Envie o evento como JSON");
    authenticateHubWebhook(request.body, request.headers["x-hub-timestamp"], request.headers["x-hub-signature"]);
    let body: unknown;
    try { body = JSON.parse(request.body.toString("utf8")); }
    catch { throw httpError(400, "WEBHOOK_JSON_INVALID", "O evento não contém JSON válido"); }
    const envelope = hubEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      // a rota é silent; só o caminho do campo recusado, nunca o valor
      app.log.warn({ paths: envelope.error.issues.map(issue => issue.path.join(".")) }, "meta hub webhook envelope rejected");
      throw httpError(422, "WEBHOOK_ENVELOPE_INVALID", "Envelope de webhook inválido");
    }
    // 503 faz o hub reentregar pela tabela de retentativas (hub:1143); nunca confirmar sem gravar
    try { await capture(envelope.data, new Date()); }
    catch (error) {
      // erro do ORM pode trazer o payload nos parâmetros: só o código Pxxxx e o tipo do evento
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "unknown";
      app.log.error({ code, type: envelope.data.type }, "meta hub webhook persistence failed");
      throw httpError(503, "WEBHOOK_PERSISTENCE_UNAVAILABLE", "Não foi possível guardar o evento; reenvie a entrega");
    }
    // nenhum domínio antes do ACK; sem Redis, a varredura processa o journal
    if (queueEnabled()) void dispatchDueEvents().catch(() => {});
    return { received: true };
  });
};
export default metaHubWebhookRoutes;
