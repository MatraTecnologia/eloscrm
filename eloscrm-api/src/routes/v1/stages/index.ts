import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { updateStageSchema } from "../../../modules/pipelines/pipelines.schema.js";
import * as service from "../../../modules/pipelines/pipelines.service.js";

const stagesRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateStageSchema.parse(request.body);
    return service.updateStage(request.orgId!, id, data);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.removeStage(request.orgId!, id);
    return reply.status(204).send();
  });
};

export default stagesRoutes;
