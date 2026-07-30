import type { ClientStatus, NurtureReason, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "./clients.schema.js";

export const listClients = (orgId: string, filters: ListClientsQuery) => {
  const where: Prisma.ClientWhereInput = { organizationId: orgId };
  if (filters.status !== "ALL") where.status = filters.status;
  // vencido só faz sentido dentro da nutrição: em ACTIVE/ALL o campo é nulo e o filtro esvaziaria a lista
  if (filters.overdue && filters.status === "NURTURING") where.nurtureUntil = { lte: new Date() };
  if (filters.source) where.source = filters.source;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.temperature) where.temperature = filters.temperature;
  // `has` casa a tag exata dentro do array — `contains` faria match parcial e traria "vip-ouro" em "vip"
  if (filters.tag) where.tags = { has: filters.tag };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
      { phone: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return prisma.client.findMany({ where, orderBy: { createdAt: "desc" } });
};

export const findClient = (orgId: string, id: string) =>
  prisma.client.findFirst({ where: { id, organizationId: orgId } });

export const createClient = (orgId: string, data: CreateClientInput) =>
  prisma.client.create({ data: { ...data, organizationId: orgId } });

export const updateClientById = (id: string, data: UpdateClientInput) =>
  prisma.client.update({ where: { id }, data });

export const deleteClientById = (id: string) =>
  prisma.client.delete({ where: { id } });

// os campos de nutrição não passam pelo UpdateClientInput de propósito (o PATCH não pode mexer em
// `status`), então a escrita do estado tem a própria porta no repo
export type NurtureState = {
  status: ClientStatus;
  nurtureReason: NurtureReason | null;
  nurtureNote: string | null;
  nurtureUntil: Date | null;
  nurturedAt: Date | null;
};

export const updateNurtureState = (id: string, data: NurtureState) =>
  prisma.client.update({ where: { id }, data });
