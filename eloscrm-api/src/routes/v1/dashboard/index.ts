import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import * as service from "../../../modules/dashboard/dashboard.service.js";

const dashboardRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/stats", async (request) => service.getStats(request.orgId!));
};

export default dashboardRoutes;
