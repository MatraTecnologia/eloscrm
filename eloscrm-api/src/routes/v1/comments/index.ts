import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { actorOf } from "../../../lib/actor.js";
import {
  createCommentSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from "../../../modules/comments/comments.schema.js";
import * as service from "../../../modules/comments/comments.service.js";

const commentsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listCommentsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createCommentSchema.parse(request.body);
    const comment = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(comment);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { body } = updateCommentSchema.parse(request.body);
    return service.update(request.orgId!, id, body, actorOf(request));
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });
};

export default commentsRoutes;
