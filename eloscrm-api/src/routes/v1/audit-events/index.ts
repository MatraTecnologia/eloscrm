import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { listAuditQuerySchema } from "../../../modules/audit/audit.schema.js";
import * as service from "../../../modules/audit/audit.service.js";

const auditEventsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listAuditQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters);
  });
};

export default auditEventsRoutes;
