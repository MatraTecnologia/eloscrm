import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

declare module "fastify" {
  interface FastifyRequest {
    session: NonNullable<AuthSession>["session"] | null;
    user: NonNullable<AuthSession>["user"] | null;
  }
}

export const authGuardPlugin = fp(async (app) => {
  app.decorateRequest("session", null);
  app.decorateRequest("user", null);
});

export const authGuard = async (request: FastifyRequest, reply: FastifyReply) => {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!result) {
    return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Não autenticado" } });
  }
  request.session = result.session;
  request.user = result.user;
};
