import Fastify, { type FastifyInstance } from "fastify";
import autoLoad from "@fastify/autoload";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { errorHandler } from "./plugins/error-handler.js";
import { corsPlugin } from "./plugins/cors.js";
import { authHandler } from "./plugins/auth-handler.js";
import { authGuardPlugin } from "./plugins/auth-guard.js";
import { orgGuardPlugin } from "./plugins/org-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true });
  await app.register(errorHandler);
  await app.register(corsPlugin);
  await app.register(authHandler);
  await app.register(authGuardPlugin);
  await app.register(orgGuardPlugin);

  // O prefixo de cada rota vem do caminho da pasta em routes/ (health -> /health, v1/me -> /v1/me);
  // cada index.ts registra em app.get("/").
  await app.register(autoLoad, {
    dir: join(__dirname, "routes"),
  });

  return app;
};
