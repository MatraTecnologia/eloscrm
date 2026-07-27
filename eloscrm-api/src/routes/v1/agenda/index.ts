import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { listAgendaQuerySchema } from "../../../modules/agenda/agenda.schema.js";
import * as service from "../../../modules/agenda/agenda.service.js";

const agendaRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listAgendaQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });
};

export default agendaRoutes;
