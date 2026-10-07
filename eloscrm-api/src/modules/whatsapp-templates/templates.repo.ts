import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const membership = (organizationId: string, userId: string) => prisma.member.findFirst({ where: { organizationId, userId }, select: { role: true } });
export const save = (organizationId: string, wabaId: string, definition: { id: string; name: string; language: string; category: string; status: string; components: Record<string, unknown>[] }) => prisma.officialTemplate.upsert({
  where: { organizationId_wabaId_externalId: { organizationId, wabaId, externalId: definition.id } },
  create: { organizationId, wabaId, externalId: definition.id, name: definition.name, language: definition.language, category: definition.category, status: definition.status, definition: definition as Prisma.InputJsonObject },
  update: { status: definition.status, definition: definition as Prisma.InputJsonObject, syncedAt: new Date() },
});
export const markDeleted = (organizationId: string, wabaId: string, id: string) => prisma.officialTemplate.updateMany({ where: { organizationId, wabaId, id }, data: { status: "MISSING", syncedAt: new Date() } });
