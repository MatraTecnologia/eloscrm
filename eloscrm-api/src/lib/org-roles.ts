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

/**
 * Dono da imobiliária, e só ele.
 *
 * Separado de `isOrgManager` de propósito: gestor inclui `admin`, e há decisões que não são de
 * gestor — excluir o tenant é a única coisa no sistema que apaga tudo de uma vez. Alargar
 * `isOrgManager` mudaria o significado nos quatro lugares que já dependem dele.
 */
export const isOrgOwner = async (orgId: string, userId: string) => {
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, userId },
    select: { role: true },
  });
  return member?.role === "owner";
};
