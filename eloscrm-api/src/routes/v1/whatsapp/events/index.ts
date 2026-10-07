import type { FastifyInstance } from "fastify";
import * as z from "zod";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { eventParamsSchema, journalQuerySchema } from "../../../../modules/whatsapp-official/webhook.schema.js";
import { listEvents, replayEvent } from "../../../../modules/whatsapp-official/webhook.service.js";
import { actorOf } from "../../../../lib/actor.js";

const eventRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  app.get("/", async request => listEvents(request.orgId!, request.user!.id, journalQuerySchema.parse(request.query)));
  app.post("/:id/replay", async request => {
    z.strictObject({}).parse(request.body ?? {});
    const { id } = eventParamsSchema.parse(request.params);
    return replayEvent(request.orgId!, request.user!.id, id, actorOf(request));
  });
};
export default eventRoutes;
