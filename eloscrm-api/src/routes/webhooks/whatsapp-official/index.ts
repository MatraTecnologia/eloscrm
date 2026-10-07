import type { FastifyInstance } from "fastify";
import { authenticateOfficialWebhook, verifyWebhookChallenge } from "../../../lib/whatsapp-official/webhook-auth.js";
import { httpError } from "../../../lib/http-error.js";
import { capture } from "../../../modules/whatsapp-official/webhook.repo.js";
import { dispatchDueEvents } from "../../../modules/whatsapp-official/webhook.service.js";
import { queueEnabled } from "../../../lib/queue.js";

const officialWebhookRoutes = async (app: FastifyInstance) => {
  // Parser encapsulado: HMAC usa os bytes originais; as outras rotas continuam recebendo JSON.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const requests = new Map<string, { startedAt: number; count: number }>();
  app.addHook("onRequest", async request => {
    const now = Date.now();
    const bucket = requests.get(request.ip);
    if (!bucket || now - bucket.startedAt >= 1000) {
      if (requests.size >= 2000) requests.clear();
      requests.set(request.ip, { startedAt: now, count: 1 });
    } else if (++bucket.count > 200) throw httpError(429, "WEBHOOK_RATE_LIMIT", "Limite de recebimento excedido; tente novamente");
  });

  // O query do GET contém o verify token; o logger de requests não deve registrá-lo.
  app.get("/", { logLevel: "silent" }, async (request, reply) => reply.type("text/plain").send(verifyWebhookChallenge(request.query as Record<string, unknown>)));
  app.post("/", { logLevel: "silent", bodyLimit: 16 * 1024 * 1024 }, async request => {
    if (!Buffer.isBuffer(request.body)) throw httpError(415, "WEBHOOK_CONTENT_TYPE", "Envie o evento como JSON");
    authenticateOfficialWebhook(request.body, request.headers["x-hub-signature-256"]);
    let body: unknown;
    try { body = JSON.parse(request.body.toString("utf8")); }
    catch { throw httpError(400, "WEBHOOK_JSON_INVALID", "O evento não contém JSON válido"); }
    try { await capture(body, new Date()); }
    catch (error) {
      // Não encaminha erro do ORM ao logger: parâmetros podem conter mensagens privadas.
      if (error instanceof Error && error.name === "ZodError") throw httpError(422, "WEBHOOK_ENVELOPE_INVALID", "Envelope de webhook inválido");
      throw httpError(503, "WEBHOOK_PERSISTENCE_UNAVAILABLE", "Não foi possível guardar o evento; reenvie a entrega");
    }
    // Sem Redis, o processamento fica para a rotina local, mantendo o ACK independente do domínio.
    if (queueEnabled()) {
      void dispatchDueEvents().catch(() => {});
    }
    return { received: true };
  });
};
export default officialWebhookRoutes;
