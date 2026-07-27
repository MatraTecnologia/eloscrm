import fp from "fastify-plugin";
import cors from "@fastify/cors";
import { env } from "../env.js";

export const corsPlugin = fp(async (app) => {
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
});
