import type { FastifyInstance } from "fastify";

const healthRoutes = async (app: FastifyInstance) => {
  app.get("/", async () => ({ status: "ok" }));
};

export default healthRoutes;
