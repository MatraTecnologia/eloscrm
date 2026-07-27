import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    orgId: string | null;
  }
}

export const orgGuardPlugin = fp(async (app) => {
  app.decorateRequest("orgId", null);
});

export const orgGuard = async (request: FastifyRequest, reply: FastifyReply) => {
  // Defesa em profundidade: o authGuard sempre precede este guard e garante sessão,
  // mas se o orgGuard for usado isolado, sem sessão é 401 (não autenticado), não 403.
  if (!request.session) {
    return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Não autenticado" } });
  }
  const activeOrgId = request.session.activeOrganizationId ?? null;
  if (!activeOrgId) {
    return reply.status(403).send({
      error: { code: "NO_ACTIVE_ORG", message: "Nenhuma imobiliária ativa na sessão" },
    });
  }
  request.orgId = activeOrgId;
};
