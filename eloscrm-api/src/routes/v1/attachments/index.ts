import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { actorOf } from "../../../lib/actor.js";
import {
  listAttachmentsQuerySchema,
  uploadUrlSchema,
} from "../../../modules/attachments/attachments.schema.js";
import * as service from "../../../modules/attachments/attachments.service.js";

const attachmentsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listAttachmentsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/upload-url", async (request, reply) => {
    const data = uploadUrlSchema.parse(request.body);
    const result = await service.createUploadUrl(request.orgId!, data, actorOf(request));
    return reply.status(201).send(result);
  });

  app.post("/:id/confirm", async (request) => {
    const { id } = request.params as { id: string };
    return service.confirm(request.orgId!, id);
  });

  app.get("/:id/download-url", async (request) => {
    const { id } = request.params as { id: string };
    return service.downloadUrl(request.orgId!, id);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id);
    return reply.status(204).send();
  });
};

export default attachmentsRoutes;
