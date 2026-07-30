import { ClientStatus, type Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ListAgendaQuery } from "./agenda.schema.js";

export const listAgenda = (orgId: string, filters: ListAgendaQuery) => {
  const dueAt: Prisma.DateTimeNullableFilter = { not: null };
  if (filters.from) dueAt.gte = filters.from;
  if (filters.to) dueAt.lte = filters.to;

  return prisma.activity.findMany({
    where: { organizationId: orgId, dueAt },
    orderBy: { dueAt: "asc" },
    // a agenda é a única view que lista atividades de clientes diferentes lado a lado, então
    // precisa do vínculo junto; /activities já é sempre consultada filtrando por um clientId/dealId
    include: {
      client: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
    },
  });
};

export const listNurtureDue = (orgId: string, filters: ListAgendaQuery) => {
  const nurtureUntil: Prisma.DateTimeNullableFilter = { not: null };
  if (filters.from) nurtureUntil.gte = filters.from;
  if (filters.to) nurtureUntil.lte = filters.to;

  return prisma.client.findMany({
    where: { organizationId: orgId, status: ClientStatus.NURTURING, nurtureUntil },
    orderBy: { nurtureUntil: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      nurtureUntil: true,
      nurtureReason: true,
      nurtureNote: true,
    },
  });
};
