import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { actorOf } from "../../../../lib/actor.js";
import { connectionParamsSchema } from "../../../../modules/channel-connections/channel-connections.schema.js";
import { historySchema, retentionSchema, disableSchema } from "../../../../modules/whatsapp-maintenance/maintenance.schema.js";
import * as service from "../../../../modules/whatsapp-maintenance/maintenance.service.js";

const maintenanceRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  app.post("/history", async request => service.backfillHistory(request.orgId!, historySchema.parse(request.body ?? {}), actorOf(request)));
  app.post("/retention", async request => service.purgePayloads(request.orgId!, retentionSchema.parse(request.body ?? {} ).apply, actorOf(request)));
  app.post("/connections/:id/disable", async request => {
    const { id } = connectionParamsSchema.parse(request.params);
    disableSchema.parse(request.body);
    return service.disable(request.orgId!, id, actorOf(request));
  });
};

export default maintenanceRoutes;
