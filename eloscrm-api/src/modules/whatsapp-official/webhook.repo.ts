import { prisma } from "../../lib/prisma.js";
import { Prisma, type OfficialWebhookStatus } from "../../generated/prisma/client.js";
import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import type { ItemResult } from "./webhook-processing.service.js";
import { envelopeSchema, eventHash, objectSchema, stringOf } from "./webhook.schema.js";

export const journalSelect = {
  id: true, connectionId: true, field: true, status: true, attempts: true,
  lastErrorCode: true, receivedAt: true, processedAt: true, nextAttemptAt: true,
  processedItemCount: true, failedItemCount: true, syncDetails: true,
} satisfies Prisma.OfficialWebhookEventSelect;

// Exceção ao filtro por org: o evento assinado resolve o tenant pelo cadastro autorizado do ativo.
export const resolveConnection = (wabaId: string, phoneNumberId?: string) => phoneNumberId
  ? prisma.channelConnection.findFirst({ where: { provider: "cloud_api", wabaId, phoneNumberId } })
  : Promise.resolve(null);

export const capture = async (body: unknown, receivedAt: Date) => {
  const envelope = envelopeSchema.parse(body);
  const rows: Prisma.OfficialWebhookEventCreateManyInput[] = [];
  for (const entry of envelope.entry) {
    for (const change of entry.changes) {
      const metadata = objectSchema.safeParse(change.value.metadata).data ?? {};
      const phoneNumberId = stringOf(metadata.phone_number_id);
      const connection = await resolveConnection(entry.id, phoneNumberId);
      rows.push({
        dedupKey: eventHash({ wabaId: entry.id, field: change.field, value: change.value }),
        wabaId: entry.id, phoneNumberId, field: change.field, payload: change.value as Prisma.InputJsonObject,
        organizationId: connection?.organizationId, connectionId: connection?.id,
        status: connection ? "pending" : "unresolved", receivedAt, nextAttemptAt: receivedAt,
      });
    }
  }
  // Uma única escrita: falha no banco não confirma parcialmente o envelope à Meta.
  await prisma.officialWebhookEvent.createMany({ data: rows, skipDuplicates: true });
};

export const dueEvents = (now: Date, limit = 100) => prisma.officialWebhookEvent.findMany({
  where: { OR: [
    { status: { in: ["pending", "unresolved"] }, nextAttemptAt: { lte: now } },
    { status: "failed", attempts: { lt: 10 }, nextAttemptAt: { lte: now } },
    { status: "processing", leaseExpiresAt: { lte: now } },
  ] }, select: { id: true }, orderBy: { nextAttemptAt: "asc" }, take: limit,
});

export const claim = async (id: string, leaseToken: string, now: Date) => {
  const result = await prisma.officialWebhookEvent.updateMany({
    where: { id, OR: [
      { status: { in: ["pending", "unresolved"] }, nextAttemptAt: { lte: now } },
      { status: "failed", attempts: { lt: 10 }, nextAttemptAt: { lte: now } },
      { status: "processing", leaseExpiresAt: { lte: now } },
    ] },
    data: { status: "processing", leaseToken, leaseExpiresAt: new Date(now.getTime() + 120_000), attempts: { increment: 1 } },
  });
  return result.count ? prisma.officialWebhookEvent.findFirst({ where: { id, leaseToken } }) : null;
};

export const finish = (id: string, leaseToken: string, status: OfficialWebhookStatus, lastErrorCode?: string, outcome?: { results: ItemResult[]; syncDetails: Record<string, unknown>[] }) => prisma.officialWebhookEvent.updateMany({
  where: { id, leaseToken, status: "processing" }, data: {
    status, lastErrorCode: lastErrorCode ?? null, leaseToken: null, leaseExpiresAt: null,
    processedAt: status === "processed" ? new Date() : null, nextAttemptAt: new Date(Date.now() + 60_000),
    ...(outcome ? {
      processedItemCount: outcome.results.filter(item => item.status === "processed").length,
      failedItemCount: outcome.results.filter(item => item.status === "failed").length,
      itemResults: outcome.results as unknown as Prisma.InputJsonArray,
      syncDetails: outcome.syncDetails as Prisma.InputJsonArray,
    } : {}),
  },
});

export const attachConnection = (id: string, leaseToken: string, orgId: string, connectionId: string) => prisma.officialWebhookEvent.updateMany({
  where: { id, leaseToken, organizationId: null }, data: { organizationId: orgId, connectionId },
});

export const list = (orgId: string, query: { status?: OfficialWebhookStatus; limit: number }) => prisma.officialWebhookEvent.findMany({
  where: { organizationId: orgId, ...(query.status ? { status: query.status } : {}) }, select: journalSelect,
  orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: query.limit,
});

export const reset = async (orgId: string, id: string, actor: Actor) => prisma.$transaction(async tx => {
  const result = await tx.officialWebhookEvent.updateMany({
    where: { id, organizationId: orgId, status: { in: ["failed", "unsupported", "unresolved"] } },
    data: { status: "pending", attempts: 0, lastErrorCode: null, nextAttemptAt: new Date() },
  });
  if (result.count) await recordAudit({
    orgId, entityType: AuditEntity.ORGANIZATION, entityId: orgId, action: AuditAction.WEBHOOK_RECONCILED, actor,
    context: { eventId: id, operation: "official_webhook_replay" },
  }, tx);
  return result.count;
});
export const findPublic = (orgId: string, id: string) => prisma.officialWebhookEvent.findFirst({ where: { id, organizationId: orgId }, select: journalSelect });
