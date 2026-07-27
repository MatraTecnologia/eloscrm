import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";

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
  // A sessão guarda a org ativa por tempo indeterminado, mas a organização pode ter sido excluída
  // ou o usuário removido dela nesse meio-tempo. Sem esta checagem o orgId segue para as queries e
  // o insert estoura em violação de FK — 500 genérico no lugar de um erro que o front sabe tratar.
  const membership = await prisma.member.findFirst({
    where: { userId: request.session.userId, organizationId: activeOrgId },
    select: { id: true },
  });
  if (!membership) {
    return reply.status(403).send({
      error: { code: "NO_ACTIVE_ORG", message: "A imobiliária ativa não está mais disponível" },
    });
  }
  request.orgId = activeOrgId;
};
