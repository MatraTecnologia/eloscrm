import {
  BroadcastRecipientStatus,
  BroadcastStatus,
  type Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, notFound } from "../../lib/http-error.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import type { BroadcastFilters } from "./broadcasts.schema.js";

const dealInclude = {
  client: { select: { id: true, name: true, phone: true, temperature: true } },
  property: { select: { title: true } },
  tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
} satisfies Prisma.DealInclude;

export type MatchedDeal = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

/** Traduz as condições para o `where`. Cada uma só entra quando veio — omitida não restringe. */
export const matchDeals = (orgId: string, pipelineId: string, f: BroadcastFilters, options?: { dealIds?: string[]; limit?: number }) => {
  const where: Prisma.DealWhereInput = { organizationId: orgId, pipelineId };
  if (f.stageIds?.length) where.stageId = { in: f.stageIds };
  if (f.ownerIds?.length) where.ownerId = { in: f.ownerIds };
  if (f.tagsAny?.length) where.tags = { some: { id: { in: f.tagsAny } } };
  if (f.tagsNone?.length) where.NOT = { tags: { some: { id: { in: f.tagsNone } } } };
  if (f.value === "EMPTY") where.value = null;
  if (f.value === "FILLED" || f.valueMin !== undefined || f.valueMax !== undefined) {
    where.value = {
      not: null,
      ...(f.valueMin !== undefined ? { gte: f.valueMin } : {}),
      ...(f.valueMax !== undefined ? { lte: f.valueMax } : {}),
    };
  }
  if (f.temperatures?.length) where.client = { temperature: { in: f.temperatures } };
  if (options?.dealIds) where.id = { in: options.dealIds };
  return prisma.deal.findMany({ where, include: dealInclude, orderBy: { createdAt: "desc" }, ...(options?.limit ? { take: options.limit } : {}) });
};

export const findPipeline = (orgId: string, id: string) =>
  prisma.pipeline.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true } });

export const memberNames = async (orgId: string, userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, string>();
  const members = await prisma.member.findMany({
    where: { organizationId: orgId, userId: { in: userIds } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(members.map((m) => [m.userId, m.user.name]));
};

export const createBroadcast = (
  data: Omit<Prisma.BroadcastUncheckedCreateInput, "recipients">,
  recipients: Omit<Prisma.BroadcastRecipientUncheckedCreateInput, "broadcastId">[],
) =>
  prisma.broadcast.create({
    data: { ...data, recipients: { createMany: { data: recipients } } },
    include: { recipients: true },
  });

export const listBroadcasts = (orgId: string, pipelineId?: string) =>
  prisma.broadcast.findMany({
    where: { organizationId: orgId, ...(pipelineId ? { pipelineId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

export const findBroadcast = (orgId: string, id: string) =>
  prisma.broadcast.findFirst({
    where: { id, organizationId: orgId },
    include: { recipients: { orderBy: { createdAt: "asc" } } },
  });

export const findRecipient = (id: string) =>
  prisma.broadcastRecipient.findUnique({ where: { id }, include: { broadcast: true } });

export const existing = (orgId: string, idempotencyKey: string) => prisma.broadcast.findFirst({ where: { organizationId: orgId, id: idempotencyKey }, include: { recipients: true } });

export const transition = (orgId: string, id: string, status: "RUNNING" | "PAUSED", actor: Actor) => prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${id}`}, 0))`;
  const saved = await tx.broadcast.findFirst({ where: { organizationId: orgId, id } });
  if (!saved) throw notFound("Disparo não encontrado");
  if (!["RUNNING", "PAUSED"].includes(saved.status)) throw conflict("BROADCAST_FINISHED", "Este disparo já foi encerrado");
  const updated = await tx.broadcast.update({ where: { id }, data: { status } });
  await recordAudit({ orgId, entityType: "BROADCAST", entityId: id, action: "UPDATED", actor, context: { status } }, tx);
  return updated;
});

export const claimRecipient = (id: string, spacing: boolean) => prisma.$transaction(async tx => {
  const reference = await tx.broadcastRecipient.findUnique({ where: { id }, select: { broadcastId: true, broadcast: { select: { organizationId: true } } } });
  if (!reference) return null;
  const orgId = reference.broadcast.organizationId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast-dispatch:${orgId}`}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${reference.broadcastId}`}, 0))`;
  const row = await tx.broadcastRecipient.findFirst({ where: { id, status: "PENDING", broadcast: { organizationId: orgId, status: "RUNNING", ...(spacing ? { nextAt: { lte: new Date() } } : {}) } }, include: { broadcast: true } });
  if (!row) return null;
  const occupied = await tx.broadcastRecipient.count({ where: { status: "PROCESSING", broadcast: { organizationId: orgId }, leaseExpiresAt: { gt: new Date() } } });
  const cooling = spacing && await tx.broadcast.count({ where: { organizationId: orgId, nextAt: { gt: new Date() } } });
  if (occupied || cooling) return null;
  await tx.broadcastRecipient.update({ where: { id }, data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 180000) } });
  await tx.broadcast.update({ where: { id: row.broadcastId }, data: { nextAt: new Date(Date.now() + 10000) } });
  return row;
});

export const releaseRecipient = (id: string) => prisma.broadcastRecipient.updateMany({ where: { id, status: "PROCESSING" }, data: { status: "PENDING", leaseExpiresAt: null } });
export const recoverable = () => prisma.broadcastRecipient.findMany({ where: { OR: [{ status: "PENDING", broadcast: { status: "RUNNING", nextAt: { lte: new Date() } } }, { status: "PROCESSING", leaseExpiresAt: { lte: new Date() } }] }, select: { id: true, broadcastId: true, status: true }, orderBy: { createdAt: "asc" }, take: 200 });

export const cancelBroadcast = (id: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${id}`}, 0))`;
    const current = await tx.broadcast.findUnique({ where: { id } });
    if (!current || !["RUNNING", "PAUSED"].includes(current.status)) throw conflict("BROADCAST_FINISHED", "Este disparo já foi encerrado");
    const pending = await tx.broadcastRecipient.updateMany({
      where: { broadcastId: id, status: BroadcastRecipientStatus.PENDING },
      data: { status: BroadcastRecipientStatus.SKIPPED, error: "Disparo encerrado", errorCode: "BROADCAST_STOPPED", errorStage: "validation", completedAt: new Date() },
    });
    return tx.broadcast.update({
      where: { id },
      data: {
        status: BroadcastStatus.CANCELED,
        skipped: { increment: pending.count },
        finishedAt: new Date(),
      },
    });
  });

/**
 * Fecha o destinatário e soma no contador do disparo numa transação só; o `DONE` sai do próprio
 * resultado do incremento, então dois workers terminando ao mesmo tempo não deixam o disparo
 * "rodando" para sempre nem o fecham duas vezes.
 */
export const settleRecipient = (
  recipientId: string,
  broadcastId: string,
  outcome:
    | { status: "SENT"; messageId: string }
    | { status: "FAILED" | "SKIPPED" | "UNKNOWN"; error: string; errorCode?: string; errorStage?: string },
) =>
  prisma.$transaction(async (tx) => {
    const updated = await tx.broadcastRecipient.updateMany({
      where: { id: recipientId, broadcastId, status: { in: ["PENDING", "PROCESSING"] } },
      data:
        outcome.status === "SENT"
          ? { status: BroadcastRecipientStatus.SENT, messageId: outcome.messageId, sentAt: new Date(), completedAt: new Date(), leaseExpiresAt: null }
          : { status: BroadcastRecipientStatus[outcome.status], error: outcome.error, errorCode: outcome.errorCode, errorStage: outcome.errorStage, completedAt: new Date(), leaseExpiresAt: null },
    });
    if (!updated.count) return;
    const counter = { SENT: "sent", FAILED: "failed", SKIPPED: "skipped", UNKNOWN: "uncertain" }[outcome.status];
    const broadcast = await tx.broadcast.update({
      where: { id: broadcastId },
      data: { [counter]: { increment: 1 } },
    });
    const completed = broadcast.sent + broadcast.failed + broadcast.skipped + broadcast.uncertain >= broadcast.total;
    if (completed && ["RUNNING", "PAUSED"].includes(broadcast.status)) {
      await tx.broadcast.update({
        where: { id: broadcastId },
        data: { status: BroadcastStatus.DONE, finishedAt: new Date() },
      });
    }
  });

export const findConversationByPhoneKey = (orgId: string, instanceId: string, phoneKey: string) =>
  prisma.conversation.findFirst({
    where: { organizationId: orgId, instanceId, isGroup: false, phoneKey },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
  });
