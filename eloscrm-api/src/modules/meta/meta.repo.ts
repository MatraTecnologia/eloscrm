import { prisma } from "../../lib/prisma.js";

const withRelations = {
  pages: { select: { id: true, pageId: true, name: true }, orderBy: { name: "asc" as const } },
  forms: {
    include: { page: { select: { pageId: true, name: true } } },
    orderBy: [{ page: { name: "asc" as const } }, { name: "asc" as const }],
  },
};

export const findByOrg = (orgId: string) =>
  prisma.metaIntegration.findUnique({ where: { organizationId: orgId }, include: withRelations });

export type IntegrationWithRelations = NonNullable<Awaited<ReturnType<typeof findByOrg>>>;

export const findForm = (integrationId: string, id: string) =>
  prisma.metaLeadForm.findFirst({ where: { id, integrationId } });

export const listLeads = (orgId: string, limit: number) =>
  prisma.metaLead.findMany({
    where: { organizationId: orgId },
    orderBy: { receivedAt: "desc" },
    take: limit,
    include: { form: { select: { name: true, page: { select: { name: true } } } } },
  });

/**
 * Integrações que o cron precisa visitar: ativas e com pelo menos um formulário ligado. Traz o token
 * cifrado de cada página junto, para a rodada não voltar ao banco por formulário.
 */
export const listSyncable = () =>
  prisma.metaIntegration.findMany({
    where: { status: "active", forms: { some: { enabled: true } } },
    include: {
      forms: { where: { enabled: true }, include: { page: { select: { tokenEnc: true } } } },
    },
  });
