import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";

const orgScopeRoutes = async (app: FastifyInstance) => {
  app.get("/", { preHandler: [authGuard, orgGuard] }, async (request) => ({
    orgId: request.orgId,
  }));
};

export default orgScopeRoutes;
