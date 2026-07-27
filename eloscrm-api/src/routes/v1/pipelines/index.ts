import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import {
  createPipelineSchema,
  createStageSchema,
  reorderStagesSchema,
  updatePipelineSchema,
} from "../../../modules/pipelines/pipelines.schema.js";
import * as service from "../../../modules/pipelines/pipelines.service.js";

const pipelinesRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => service.list(request.orgId!));

  app.post("/", async (request, reply) => {
    const data = createPipelineSchema.parse(request.body);
    const pipeline = await service.create(request.orgId!, data);
    return reply.status(201).send(pipeline);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updatePipelineSchema.parse(request.body);
    return service.update(request.orgId!, id, data);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id);
    return reply.status(204).send();
  });

  app.post("/:id/stages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = createStageSchema.parse(request.body);
    const stage = await service.addStage(request.orgId!, id, data);
    return reply.status(201).send(stage);
  });

  app.patch("/:id/reorder-stages", async (request) => {
    const { id } = request.params as { id: string };
    const data = reorderStagesSchema.parse(request.body);
    return service.reorderStages(request.orgId!, id, data);
  });
};

export default pipelinesRoutes;
