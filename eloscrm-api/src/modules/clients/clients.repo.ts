import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "./clients.schema.js";

export const listClients = (orgId: string, filters: ListClientsQuery) => {
  const where: Prisma.ClientWhereInput = { organizationId: orgId };
  if (filters.source) where.source = filters.source;
  if (filters.ownerId) where.ownerId = filters.ownerId;
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
