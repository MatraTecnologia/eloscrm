import fp from "fastify-plugin";
import cors from "@fastify/cors";
import { env } from "../env.js";

export const corsPlugin = fp(async (app) => {
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    // A lista é fechada de propósito, então método novo na API exige passar por aqui — e o
    // preflight falha no navegador sem nenhum teste acusar, porque `app.inject` não faz CORS.
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
});
