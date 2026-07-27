import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../plugins/auth-guard.js";

const meRoutes = async (app: FastifyInstance) => {
  app.get("/", { preHandler: authGuard }, async (request) => ({
    userId: request.user?.id,
    email: request.user?.email,
  }));
};

export default meRoutes;
