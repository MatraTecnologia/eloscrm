import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { createTagSchema, updateTagSchema } from "../../../modules/tags/tags.schema.js";
import * as service from "../../../modules/tags/tags.service.js";

const tagsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => service.list(request.orgId!));

  app.post("/", async (request, reply) => {
    const data = createTagSchema.parse(request.body);
    const tag = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(tag);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateTagSchema.parse(request.body);
    return service.update(request.orgId!, id, data, actorOf(request));
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });
};

export default tagsRoutes;
