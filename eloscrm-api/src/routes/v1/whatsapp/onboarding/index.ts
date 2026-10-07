import type { FastifyInstance } from "fastify";
import { env } from "../../../../env.js";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { actorOf } from "../../../../lib/actor.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import * as schema from "../../../../modules/whatsapp-onboarding/onboarding.schema.js";
import * as service from "../../../../modules/whatsapp-onboarding/onboarding.service.js";

const onboardingRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  const requests = new Map<string, { at: number; count: number }>();
  app.addHook("preHandler", async request => {
    if (request.method === "GET") return;
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada para conectar o WhatsApp");
    const now = Date.now();
    const key = request.user!.id;
    const bucket = requests.get(key);
    if (!bucket || now - bucket.at > 60_000) {
      if (requests.size > 2000) requests.clear();
      requests.set(key, { at: now, count: 1 });
    } else if (++bucket.count > 60) throw httpError(429, "OFFICIAL_ONBOARDING_RATE_LIMIT", "Aguarde um minuto antes de tentar conectar novamente");
  });
  // O body contém um código de autorização; não encaminha erros de ORM ou provider ao logger.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && "expose" in error && error.expose === true && "statusCode" in error && typeof error.statusCode === "number" && "code" in error && typeof error.code === "string") {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof Error && error.name === "ZodError") return reply.status(422).send({ error: { code: "VALIDATION", message: "Dados inválidos para conectar o WhatsApp" } });
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Não foi possível concluir a conexão" } });
  });
  const scope = (request: Parameters<typeof actorOf>[0]) => ({ orgId: request.orgId!, userId: request.user!.id, sessionId: request.session!.id });
  app.get("/config", async request => service.configuration(scope(request)));
  app.post("/", { bodyLimit: 8192, logLevel: "silent" }, async request => { schema.emptyBodySchema.parse(request.body); return service.start(scope(request)); });
  app.get("/:id", async request => service.get(scope(request), schema.attemptParamsSchema.parse(request.params).id));
  app.post("/:id/exchange", { bodyLimit: 8192, logLevel: "silent" }, async request => service.exchange(scope(request), schema.attemptParamsSchema.parse(request.params).id, schema.exchangeBodySchema.parse(request.body)));
  app.post("/:id/activate", { bodyLimit: 8192, logLevel: "silent" }, async request => service.activate(scope(request), schema.attemptParamsSchema.parse(request.params).id, schema.activateBodySchema.parse(request.body).phoneNumberId, actorOf(request)));
};
export default onboardingRoutes;
