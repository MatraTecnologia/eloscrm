import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import {
  createActivitySchema,
  listActivitiesQuerySchema,
  updateActivitySchema,
} from "../../../modules/activities/activities.schema.js";
import * as service from "../../../modules/activities/activities.service.js";

const activitiesRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listActivitiesQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createActivitySchema.parse(request.body);
    const activity = await service.create(request.orgId!, data);
    return reply.status(201).send(activity);
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateActivitySchema.parse(request.body);
    return service.update(request.orgId!, id, data);
  });
};

export default activitiesRoutes;
