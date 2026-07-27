import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CreateDealInput, ListDealsQuery, UpdateDealInput } from "./deals.schema.js";

export const listDeals = (orgId: string, filters: ListDealsQuery) => {
  const where: Prisma.DealWhereInput = { organizationId: orgId };
  if (filters.pipelineId) where.pipelineId = filters.pipelineId;
  if (filters.stageId) where.stageId = filters.stageId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  return prisma.deal.findMany({ where, orderBy: { createdAt: "desc" } });
};

export const findDeal = (orgId: string, id: string) =>
  prisma.deal.findFirst({ where: { id, organizationId: orgId } });

export const createDeal = (orgId: string, data: CreateDealInput) =>
  prisma.deal.create({ data: { ...data, organizationId: orgId } });

export const updateDealById = (id: string, data: UpdateDealInput) =>
  prisma.deal.update({ where: { id }, data });

export const deleteDealById = (id: string) => prisma.deal.delete({ where: { id } });

export const findClientInOrg = (orgId: string, clientId: string) =>
  prisma.client.findFirst({ where: { id: clientId, organizationId: orgId } });

export const findPropertyInOrg = (orgId: string, propertyId: string) =>
  prisma.property.findFirst({ where: { id: propertyId, organizationId: orgId } });
