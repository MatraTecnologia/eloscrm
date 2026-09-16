import {
  BroadcastRecipientStatus,
  BroadcastStatus,
  type Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { BroadcastFilters } from "./broadcasts.schema.js";

const dealInclude = {
  client: { select: { id: true, name: true, phone: true, temperature: true } },
  property: { select: { title: true } },
  tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
} satisfies Prisma.DealInclude;

export type MatchedDeal = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

/** Traduz as condições para o `where`. Cada uma só entra quando veio — omitida não restringe. */
export const matchDeals = (orgId: string, pipelineId: string, f: BroadcastFilters) => {
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
  return prisma.deal.findMany({ where, include: dealInclude, orderBy: { createdAt: "desc" } });
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

export const cancelBroadcast = (id: string) =>
  prisma.$transaction(async (tx) => {
    const pendentes = await tx.broadcastRecipient.updateMany({
      where: { broadcastId: id, status: BroadcastRecipientStatus.PENDING },
      data: { status: BroadcastRecipientStatus.SKIPPED, error: "Disparo cancelado" },
    });
    return tx.broadcast.update({
      where: { id },
      data: {
        status: BroadcastStatus.CANCELED,
        skipped: { increment: pendentes.count },
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
    | { status: "FAILED" | "SKIPPED"; error: string },
) =>
  prisma.$transaction(async (tx) => {
    await tx.broadcastRecipient.update({
      where: { id: recipientId },
      data:
        outcome.status === "SENT"
          ? { status: BroadcastRecipientStatus.SENT, messageId: outcome.messageId, sentAt: new Date() }
          : { status: BroadcastRecipientStatus[outcome.status], error: outcome.error },
    });
    const counter = { SENT: "sent", FAILED: "failed", SKIPPED: "skipped" }[outcome.status];
    const broadcast = await tx.broadcast.update({
      where: { id: broadcastId },
      data: { [counter]: { increment: 1 } },
    });
    const concluido = broadcast.sent + broadcast.failed + broadcast.skipped >= broadcast.total;
    if (concluido && broadcast.status === BroadcastStatus.RUNNING) {
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
