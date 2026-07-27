import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import {
  createPropertySchema,
  listPropertiesQuerySchema,
  updatePropertySchema,
} from "../../../modules/properties/properties.schema.js";
import * as service from "../../../modules/properties/properties.service.js";

const propertiesRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listPropertiesQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createPropertySchema.parse(request.body);
    const property = await service.create(request.orgId!, data);
    return reply.status(201).send(property);
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updatePropertySchema.parse(request.body);
    return service.update(request.orgId!, id, data);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id);
    return reply.status(204).send();
  });
};

export default propertiesRoutes;
