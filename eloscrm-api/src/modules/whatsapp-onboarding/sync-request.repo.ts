import { prisma } from "../../lib/prisma.js";
import type { OfficialSyncStatus } from "../../generated/prisma/client.js";

export const connection = (orgId: string, id: string) => prisma.channelConnection.findFirst({ where: { id, organizationId: orgId, provider: "cloud_api" } });
export const activateConnection = (orgId: string, id: string) => prisma.channelConnection.updateMany({ where: { id, organizationId: orgId, status: "pending" }, data: { status: "connected" } });
export const subscriptionFailed = async (orgId: string, id: string) => {
  await prisma.channelConnection.updateMany({ where: { id, organizationId: orgId, status: "pending" }, data: { updatedAt: new Date() } });
  await prisma.officialSyncRequest.updateMany({ where: { organizationId: orgId, connectionId: id, status: "pending" }, data: { lastErrorCode: "OFFICIAL_SUBSCRIPTION_FAILED" } });
};
export const requests = (orgId: string, connectionId: string) => prisma.officialSyncRequest.findMany({ where: { organizationId: orgId, connectionId } });
export const claim = async (orgId: string, id: string) => {
  const result = await prisma.officialSyncRequest.updateMany({ where: { id, organizationId: orgId, status: "pending", deadlineAt: { gt: new Date() } }, data: { status: "requesting", requestedAt: new Date(), lastErrorCode: null } });
  return result.count === 1;
};
export const accepted = async (orgId: string, id: string, requestId: string) => prisma.$transaction(async tx => {
  await tx.officialSyncRequest.updateMany({ where: { id, organizationId: orgId }, data: { requestId } });
  await tx.officialSyncRequest.updateMany({ where: { id, organizationId: orgId, status: "requesting" }, data: { status: "accepted", lastErrorCode: null } });
});
export const rejected = (orgId: string, id: string, uncertain: boolean) => prisma.officialSyncRequest.updateMany({
  where: { id, organizationId: orgId, status: "requesting" }, data: { status: uncertain ? "uncertain" : "failed", lastErrorCode: uncertain ? "OFFICIAL_SYNC_UNCERTAIN" : "OFFICIAL_SYNC_REJECTED" },
});
export const recoverStale = async () => {
  // Operação de recuperação global; cada trabalho retomado volta ao filtro de org/conexão.
  await prisma.officialSyncRequest.updateMany({ where: { status: "requesting", requestedAt: { lt: new Date(Date.now() - 45_000) } }, data: { status: "uncertain", lastErrorCode: "OFFICIAL_SYNC_UNCERTAIN" } });
  await prisma.officialSyncRequest.updateMany({ where: { status: "pending", deadlineAt: { lte: new Date() } }, data: { status: "expired", lastErrorCode: "OFFICIAL_SYNC_DEADLINE_EXPIRED" } });
};
export const dueConnections = () => prisma.channelConnection.findMany({ where: {
  provider: "cloud_api", OR: [
    { status: "pending", updatedAt: { lt: new Date(Date.now() - 30_000) } },
    { status: "connected", syncRequests: { some: { status: "pending", deadlineAt: { gt: new Date() } } } },
  ],
}, select: { id: true, organizationId: true }, take: 50 });
export const eventsFor = (orgId: string, connectionId: string, field: string, since: Date) => prisma.officialWebhookEvent.findMany({
  where: { organizationId: orgId, connectionId, field, receivedAt: { gte: since } },
  select: { status: true, syncDetails: true, processedItemCount: true },
});
export const setProgress = (orgId: string, id: string, status: OfficialSyncStatus, progress: number, lastErrorCode: string | null) => prisma.officialSyncRequest.updateMany({
  where: { organizationId: orgId, id, status: { notIn: ["pending", "expired", "failed"] } }, data: { status, progress, lastErrorCode },
});
export const activeSyncConnections = () => prisma.officialSyncRequest.findMany({ where: { status: { in: ["accepted", "receiving", "uncertain"] } }, orderBy: { updatedAt: "asc" }, distinct: ["connectionId"], select: { connectionId: true, organizationId: true }, take: 100 });
