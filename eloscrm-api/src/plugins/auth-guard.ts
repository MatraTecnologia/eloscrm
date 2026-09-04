import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

// 1.7 deixou de propagar os campos que os plugins acrescentam à sessão pelo retorno de
// `getSession`: `activeOrganizationId`, do organization plugin, sumiu do tipo (o valor continua
// vindo em runtime). `$Infer.Session` é a inferência completa, com o que os plugins declaram.
type AuthSession = typeof auth.$Infer.Session;

declare module "fastify" {
  interface FastifyRequest {
    session: AuthSession["session"] | null;
    user: AuthSession["user"] | null;
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
