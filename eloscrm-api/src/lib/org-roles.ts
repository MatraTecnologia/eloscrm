import { prisma } from "./prisma.js";

/** Papéis que mandam na imobiliária. `member` é corretor: mexe no que é dele. */
const MANAGER_ROLES = ["owner", "admin"];

/**
 * Usado pelas regras de "o autor, ou quem manda": comentário e anexo. Falha fechado — papel
 * desconhecido ou membro que saiu da organização não é gestor.
 */
export const isOrgManager = async (orgId: string, userId: string) => {
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, userId },
    select: { role: true },
  });
  return !!member && MANAGER_ROLES.includes(member.role);
};
