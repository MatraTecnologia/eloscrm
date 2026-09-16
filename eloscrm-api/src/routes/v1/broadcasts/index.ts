import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import {
  createBroadcastSchema,
  listBroadcastsQuerySchema,
  previewBroadcastSchema,
} from "../../../modules/broadcasts/broadcasts.schema.js";
import * as service from "../../../modules/broadcasts/broadcasts.service.js";

const broadcastsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const query = listBroadcastsQuerySchema.parse(request.query);
    return service.list(request.orgId!, query);
  });

  // POST e não GET: as condições são um objeto aninhado, que não cabe bem em query string
  app.post("/preview", async (request) => {
    const data = previewBroadcastSchema.parse(request.body);
    return service.preview(request.orgId!, data);
  });

  app.post("/", async (request, reply) => {
    const data = createBroadcastSchema.parse(request.body);
    const broadcast = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(broadcast);
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.post("/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    return service.cancel(request.orgId!, id, actorOf(request));
  });
};

export default broadcastsRoutes;
