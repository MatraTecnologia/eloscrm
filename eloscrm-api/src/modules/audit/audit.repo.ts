import { prisma } from "../../lib/prisma.js";
import type { ListAuditQuery } from "./audit.schema.js";

export const listEvents = (orgId: string, filters: ListAuditQuery) =>
  prisma.auditEvent.findMany({
    where: { organizationId: orgId, entityType: filters.entityType, entityId: filters.entityId },
    orderBy: { createdAt: "desc" },
    take: filters.limit,
  });
