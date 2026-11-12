import type { FastifyInstance } from "fastify";
import { env } from "../../../../env.js";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { actorOf } from "../../../../lib/actor.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import { emptyBodySchema, refreshParamsSchema } from "../../../../modules/meta-hub/connection.schema.js";
import * as service from "../../../../modules/meta-hub/hub-connect.service.js";

const hubRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  // mesmo desenho do onboarding próprio: Origin pinado e limite por usuário nas mutações
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
    } else if (++bucket.count > 60) throw httpError(429, "HUB_CONNECT_RATE_LIMIT", "Aguarde um minuto antes de tentar conectar novamente");
  });
  const scope = (request: Parameters<typeof actorOf>[0]) => ({ orgId: request.orgId!, userId: request.user!.id });
  app.get("/config", async () => service.configuration());
  // logLevel silent: a resposta leva a url com token de acesso do hub (hub:507)
  app.post("/connect-sessions", { bodyLimit: 1024, logLevel: "silent" }, async request => {
    emptyBodySchema.parse(request.body);
    return service.startSession(scope(request));
  });
  app.post("/connections/:id/refresh", { bodyLimit: 1024 }, async request => {
    emptyBodySchema.parse(request.body);
    return service.refresh(scope(request), refreshParamsSchema.parse(request.params).id, actorOf(request));
  });
};
export default hubRoutes;
