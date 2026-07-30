import type { FastifyInstance } from "fastify";
import { AuditEntity } from "../../../generated/prisma/client.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { actorOf } from "../../../lib/actor.js";
import {
  createClientSchema,
  listClientsQuerySchema,
  updateClientSchema,
} from "../../../modules/clients/clients.schema.js";
import * as service from "../../../modules/clients/clients.service.js";
import { nurtureSchema, reactivateSchema } from "../../../modules/clients/nurture.schema.js";
import * as nurtureService from "../../../modules/clients/nurture.service.js";
import { timelineQuerySchema } from "../../../modules/timeline/timeline.schema.js";
import * as timeline from "../../../modules/timeline/timeline.service.js";

const clientsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listClientsQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });

  app.post("/", async (request, reply) => {
    const data = createClientSchema.parse(request.body);
    const client = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(client);
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.get("/:id/timeline", async (request) => {
    const { id } = request.params as { id: string };
    const query = timelineQuerySchema.parse(request.query);
    // getById primeiro: sem ele, cliente de outra org devolveria lista vazia em vez de 404
    await service.getById(request.orgId!, id);
    return timeline.forEntity(request.orgId!, AuditEntity.CLIENT, id, query);
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const data = updateClientSchema.parse(request.body);
    return service.update(request.orgId!, id, data, actorOf(request));
  });

  app.post("/:id/nurture", async (request) => {
    const { id } = request.params as { id: string };
    const data = nurtureSchema.parse(request.body);
    return nurtureService.nurture(request.orgId!, id, data, actorOf(request));
  });

  app.post("/:id/reactivate", async (request) => {
    const { id } = request.params as { id: string };
    const data = reactivateSchema.parse(request.body ?? {});
    return nurtureService.reactivate(request.orgId!, id, data, actorOf(request));
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });
};

export default clientsRoutes;
