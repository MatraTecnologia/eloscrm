import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { connectionParamsSchema } from "../../../../modules/channel-connections/channel-connections.schema.js";
import * as service from "../../../../modules/channel-connections/channel-connections.service.js";
import { syncStatus } from "../../../../modules/whatsapp-onboarding/onboarding.service.js";

const connectionRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async request => service.list(request.orgId!));
  app.get("/:id/sync", async request => {
    const { id } = connectionParamsSchema.parse(request.params);
    return syncStatus({ orgId: request.orgId!, userId: request.user!.id, sessionId: request.session!.id }, id);
  });
  app.get<{ Params: { id: string } }>("/:id", async request => {
    const { id } = connectionParamsSchema.parse(request.params);
    return service.get(request.orgId!, id);
  });
};

export default connectionRoutes;
