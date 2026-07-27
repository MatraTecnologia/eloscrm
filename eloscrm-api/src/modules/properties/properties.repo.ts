import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from "./properties.schema.js";

export const listProperties = (orgId: string, filters: ListPropertiesQuery) => {
  const where: Prisma.PropertyWhereInput = { organizationId: orgId };
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { address: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return prisma.property.findMany({ where, orderBy: { createdAt: "desc" } });
};

export const findProperty = (orgId: string, id: string) =>
  prisma.property.findFirst({ where: { id, organizationId: orgId } });

export const createProperty = (orgId: string, data: CreatePropertyInput) =>
  prisma.property.create({ data: { ...data, organizationId: orgId } });

export const updatePropertyById = (id: string, data: UpdatePropertyInput) =>
  prisma.property.update({ where: { id }, data });

export const deletePropertyById = (id: string) =>
  prisma.property.delete({ where: { id } });
