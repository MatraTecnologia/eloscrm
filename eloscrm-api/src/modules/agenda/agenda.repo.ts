import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ListAgendaQuery } from "./agenda.schema.js";

export const listAgenda = (orgId: string, filters: ListAgendaQuery) => {
  const dueAt: Prisma.DateTimeNullableFilter = { not: null };
  if (filters.from) dueAt.gte = filters.from;
  if (filters.to) dueAt.lte = filters.to;

  return prisma.activity.findMany({
    where: { organizationId: orgId, dueAt },
    orderBy: { dueAt: "asc" },
  });
};
