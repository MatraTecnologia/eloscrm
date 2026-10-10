import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const membership = (organizationId: string, userId: string) => prisma.member.findFirst({ where: { organizationId, userId }, select: { role: true } });
export const findExternal = (organizationId: string, wabaId: string, externalId: string) => prisma.officialTemplate.findFirst({ where: { organizationId, wabaId, externalId }, select: { id: true } });
export const applyStatus = (organizationId: string, wabaId: string, externalId: string, data: {
  status: string; category?: string; statusEventAt: Date; statusUpdatedAt: Date;
  rejectionReason: string | null; rejectionDetail: string | null; rejectionRecommendation: string | null;
}) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-templates:${organizationId}:${wabaId}`}, 0))::text`;
  const template = await tx.officialTemplate.findFirst({ where: { organizationId, wabaId, externalId }, select: { id: true, statusEventAt: true, statusUpdatedAt: true, definition: true } });
  if (!template) return 0;
  if (template.statusEventAt && (template.statusEventAt > data.statusEventAt || (template.statusEventAt.getTime() === data.statusEventAt.getTime() && template.statusUpdatedAt && template.statusUpdatedAt > data.statusUpdatedAt))) return 1;
  const definition = template.definition as Prisma.JsonObject;
  await tx.officialTemplate.updateMany({ where: { organizationId, wabaId, id: template.id }, data: { ...data, definition: { ...definition, status: data.status, ...(data.category ? { category: data.category } : {}) } as Prisma.InputJsonObject, syncedAt: new Date() } });
  return 1;
});
export const save = (organizationId: string, wabaId: string, definition: { id: string; name: string; language: string; category: string; status: string; components: Record<string, unknown>[] }) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-templates:${organizationId}:${wabaId}`}, 0))::text`;
  const previous = await tx.officialTemplate.findFirst({ where: { organizationId, wabaId, externalId: definition.id } });
  const status = previous?.statusUpdatedAt ? previous.status : definition.status;
  const category = previous?.statusUpdatedAt ? previous.category : definition.category;
  return tx.officialTemplate.upsert({
  where: { organizationId_wabaId_externalId: { organizationId, wabaId, externalId: definition.id } },
  create: { organizationId, wabaId, externalId: definition.id, name: definition.name, language: definition.language, category: definition.category, status: definition.status, definition: definition as Prisma.InputJsonObject },
  update: { status, category, definition: { ...definition, status, category } as Prisma.InputJsonObject, syncedAt: new Date() },
  });
});
export const markDeleted = (organizationId: string, wabaId: string, id: string) => prisma.officialTemplate.updateMany({ where: { organizationId, wabaId, id }, data: { status: "MISSING", syncedAt: new Date() } });
