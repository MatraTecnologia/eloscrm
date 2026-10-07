import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { MetaFormNode } from "../../lib/meta/index.js";

type ConnectionValues = Pick<Prisma.MetaIntegrationUncheckedCreateInput, "tokenType" | "tokenEnc" | "tokenLast4" | "metaUserId" | "metaUserName"> & { connectionWarning?: string | null };
export const saveConnection = (orgId: string, values: ConnectionValues, pages: { pageId: string; name: string; tokenEnc: string; forms: MetaFormNode[] }[]) => prisma.$transaction(async tx => {
  const integration = await tx.metaIntegration.upsert({
    where: { organizationId: orgId },
    create: { ...values, organizationId: orgId },
    update: { ...values, status: "active", lastError: null },
  });
  const formIds: string[] = [];
  for (const page of pages) {
    const savedPage = await tx.metaPage.upsert({
      where: { integrationId_pageId: { integrationId: integration.id, pageId: page.pageId } },
      create: { integrationId: integration.id, pageId: page.pageId, name: page.name, tokenEnc: page.tokenEnc },
      update: { name: page.name, tokenEnc: page.tokenEnc },
    });
    for (const form of page.forms) {
      formIds.push(form.id);
      await tx.metaLeadForm.upsert({
        where: { integrationId_formId: { integrationId: integration.id, formId: form.id } },
        create: { integrationId: integration.id, pageId: savedPage.id, formId: form.id, name: form.name, remoteStatus: form.status ?? null },
        update: { pageId: savedPage.id, name: form.name, remoteStatus: form.status ?? null },
      });
    }
  }
  await tx.metaLeadForm.deleteMany({ where: { integrationId: integration.id, formId: { notIn: formIds } } });
  await tx.metaPage.deleteMany({ where: { integrationId: integration.id, pageId: { notIn: pages.map(page => page.pageId) } } });
  return integration;
});

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
