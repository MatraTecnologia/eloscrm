import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CreateActivityInput, ListActivitiesQuery, UpdateActivityInput } from "./activities.schema.js";

export const listActivities = (orgId: string, filters: ListActivitiesQuery) => {
  const where: Prisma.ActivityWhereInput = { organizationId: orgId };
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.dealId) where.dealId = filters.dealId;
  if (filters.type) where.type = filters.type;
  return prisma.activity.findMany({ where, orderBy: { createdAt: "desc" } });
};

export const findActivity = (orgId: string, id: string) =>
  prisma.activity.findFirst({ where: { id, organizationId: orgId } });

export const createActivity = (orgId: string, data: CreateActivityInput) =>
  prisma.activity.create({ data: { ...data, organizationId: orgId } });

export const updateActivityById = (id: string, data: UpdateActivityInput) =>
  prisma.activity.update({ where: { id }, data });

export const deleteActivityById = (id: string) => prisma.activity.delete({ where: { id } });
