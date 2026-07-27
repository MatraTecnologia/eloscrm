import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import {
  createDealSchema,
  listDealsQuerySchema,
  updateDealSchema,
} from "../../../modules/deals/deals.schema.js";
import * as service from "../../../modules/deals/deals.service.js";

const dealsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listDealsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createDealSchema.parse(request.body);
    const deal = await service.create(request.orgId!, data);
    return reply.status(201).send(deal);
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateDealSchema.parse(request.body);
    return service.update(request.orgId!, id, data);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id);
    return reply.status(204).send();
  });
};

export default dealsRoutes;
