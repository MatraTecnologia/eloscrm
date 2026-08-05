import type { FastifyInstance } from "fastify";
import { AuditEntity } from "../../../generated/prisma/client.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { actorOf } from "../../../lib/actor.js";
import {
  bulkTransferDealsSchema,
  createDealSchema,
  listDealsQuerySchema,
  updateDealSchema,
} from "../../../modules/deals/deals.schema.js";
import * as service from "../../../modules/deals/deals.service.js";
import { timelineQuerySchema } from "../../../modules/timeline/timeline.schema.js";
import * as timeline from "../../../modules/timeline/timeline.service.js";

const dealsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listDealsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createDealSchema.parse(request.body);
    const deal = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(deal);
  });

  app.post("/bulk-transfer", async (request) => {
    const data = bulkTransferDealsSchema.parse(request.body);
    return service.bulkTransfer(request.orgId!, data, actorOf(request));
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.get("/:id/timeline", async (request) => {
    const { id } = request.params as { id: string };
    const query = timelineQuerySchema.parse(request.query);
    // getById primeiro: sem ele, negócio de outra org devolveria lista vazia em vez de 404
    await service.getById(request.orgId!, id);
    return timeline.forEntity(request.orgId!, AuditEntity.DEAL, id, query);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateDealSchema.parse(request.body);
    return service.update(request.orgId!, id, data, actorOf(request));
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });
};

export default dealsRoutes;
