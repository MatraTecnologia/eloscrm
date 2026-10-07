import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";

export const retentionCandidates = (orgId: string, journalBefore: Date, commandBefore: Date) => Promise.all([
  prisma.officialWebhookEvent.findMany({ where: { organizationId: orgId, status: "processed", processedAt: { lt: journalBefore }, payloadPurgedAt: null, leaseToken: null }, select: { id: true }, orderBy: { id: "asc" }, take: 500 }),
  prisma.officialSendCommand.findMany({ where: { organizationId: orgId, status: { in: ["accepted", "failed"] }, updatedAt: { lt: commandBefore }, payloadPurgedAt: null, leaseToken: null }, select: { id: true }, orderBy: { id: "asc" }, take: 500 }),
]);

export const sanitizePayloads = (orgId: string, journalBefore: Date, commandBefore: Date, journalIds: string[], commandIds: string[], actor: Actor) => prisma.$transaction(async tx => {
  const journals = await tx.officialWebhookEvent.updateMany({ where: { organizationId: orgId, id: { in: journalIds }, status: "processed", processedAt: { lt: journalBefore }, payloadPurgedAt: null, leaseToken: null }, data: { payload: {}, itemResults: Prisma.DbNull, payloadPurgedAt: new Date() } });
  const commands = await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, id: { in: commandIds }, status: { in: ["accepted", "failed"] }, updatedAt: { lt: commandBefore }, payloadPurgedAt: null, leaseToken: null }, data: { request: {}, payload: {}, payloadPurgedAt: new Date() } });
  if (journals.count || commands.count) await recordAudit({ orgId, entityType: "ORGANIZATION", entityId: orgId, action: "PURGED", actor, context: { operation: "whatsapp_private_payloads", journalPayloads: journals.count, commandPayloads: commands.count } }, tx);
  return { journalPayloads: journals.count, commandPayloads: commands.count };
});

// Descoberta global só devolve tenants; cada lote de escrita volta a filtrar pela imobiliária.
export const retentionOrganizations = async (journalBefore: Date, commandBefore: Date) => {
  const [journals, commands] = await Promise.all([
    prisma.officialWebhookEvent.findMany({ where: { organizationId: { not: null }, status: "processed", processedAt: { lt: journalBefore }, payloadPurgedAt: null }, distinct: ["organizationId"], select: { organizationId: true }, take: 100 }),
    prisma.officialSendCommand.findMany({ where: { status: { in: ["accepted", "failed"] }, updatedAt: { lt: commandBefore }, payloadPurgedAt: null }, distinct: ["organizationId"], select: { organizationId: true }, take: 100 }),
  ]);
  return [...new Set([...journals, ...commands].map(row => row.organizationId).filter((id): id is string => !!id))];
};
