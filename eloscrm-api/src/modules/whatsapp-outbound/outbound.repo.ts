import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import { Prisma, type ChannelConnection } from "../../generated/prisma/client.js";
import { withConnectionLock } from "../whatsapp-official/identity.repo.js";
import { reconcileReceipts } from "../whatsapp-official/receipts.repo.js";
import type { SendInput, TemplateDefinition } from "./outbound.schema.js";
import { checkSubmission } from "../whatsapp-campaigns/submission.repo.js";

export const connection = (orgId: string, id: string) => prisma.channelConnection.findFirst({ where: { organizationId: orgId, id, provider: "cloud_api" } });
export const identity = (orgId: string, id: string) => prisma.contactIdentity.findFirst({ where: { organizationId: orgId, id } });
export const conversation = (orgId: string, connectionId: string, contactId: string) => prisma.conversation.findFirst({ where: { organizationId: orgId, connectionId, messagingContactId: contactId } });
export const quoted = (orgId: string, id: string) => prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, id } });
export const membership = (orgId: string, userId: string) => prisma.member.findFirst({ where: { organizationId: orgId, userId }, select: { id: true } });
export const template = (orgId: string, wabaId: string, id: string) => prisma.officialTemplate.findFirst({ where: { organizationId: orgId, wabaId, id } });
export const listTemplates = (orgId: string, wabaId: string) => prisma.officialTemplate.findMany({ where: { organizationId: orgId, wabaId }, orderBy: [{ name: "asc" }, { language: "asc" }], select: { id: true, name: true, language: true, category: true, status: true, definition: true, syncedAt: true, statusUpdatedAt: true, rejectionReason: true, rejectionDetail: true, rejectionRecommendation: true } });
export const saveTemplates = (orgId: string, wabaId: string, definitions: TemplateDefinition[], startedAt = new Date()) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-templates:${orgId}:${wabaId}`}, 0))::text`;
  await tx.officialTemplate.updateMany({ where: { organizationId: orgId, wabaId, OR: [{ statusUpdatedAt: null }, { statusUpdatedAt: { lte: startedAt } }] }, data: { status: "MISSING" } });
  for (const definition of definitions) {
    const previous = await tx.officialTemplate.findFirst({ where: { organizationId: orgId, wabaId, externalId: definition.id } });
    if (previous?.statusUpdatedAt && previous.statusUpdatedAt > startedAt) continue;
    const rejected = definition.status === "REJECTED";
    const rejectionReason = rejected ? (definition.rejected_reason && definition.rejected_reason !== "NONE" ? definition.rejected_reason : previous?.rejectionReason ?? null) : null;
    const sameRejection = rejected && rejectionReason === previous?.rejectionReason;
    const review = { statusUpdatedAt: startedAt, rejectionReason, rejectionDetail: sameRejection ? previous?.rejectionDetail ?? null : null, rejectionRecommendation: sameRejection ? previous?.rejectionRecommendation ?? null : null };
    await tx.officialTemplate.upsert({
    where: { organizationId_wabaId_externalId: { organizationId: orgId, wabaId, externalId: definition.id } },
    create: { organizationId: orgId, wabaId, externalId: definition.id, name: definition.name, language: definition.language, category: definition.category, status: definition.status, definition: definition as Prisma.InputJsonObject, ...review },
    update: { name: definition.name, language: definition.language, category: definition.category, status: definition.status, definition: definition as Prisma.InputJsonObject, syncedAt: new Date(), ...review },
    });
  }
}, { timeout: 30_000 });
export const upload = (orgId: string, connectionId: string, id: string) => prisma.officialUpload.findFirst({ where: { organizationId: orgId, connectionId, id } });
export const uploadKeys = (orgId: string) => prisma.officialUpload.findMany({ where: { organizationId: orgId }, select: { key: true } });
export const saveUpload = (data: Prisma.OfficialUploadUncheckedCreateInput) => prisma.officialUpload.create({ data, select: { id: true, mime: true, size: true, filename: true } });
const publicSelect = { id: true, connectionId: true, messageId: true, status: true, safeError: true, providerErrorCode: true, externalMessageId: true, createdAt: true, updatedAt: true, message: { select: { status: true } } } satisfies Prisma.OfficialSendCommandSelect;
export const publicCommand = (orgId: string, id: string) => prisma.officialSendCommand.findFirst({ where: { organizationId: orgId, id }, select: publicSelect });
export const command = (orgId: string, id: string) => prisma.officialSendCommand.findFirst({ where: { organizationId: orgId, id } });
export const existingCommand = (orgId: string, idempotencyKey: string) => prisma.officialSendCommand.findFirst({ where: { organizationId: orgId, idempotencyKey } });

export const createCommand = (channel: ChannelConnection, input: SendInput, requestHash: string, payload: Prisma.InputJsonObject, text: string | null, type: "text" | "image" | "audio" | "video" | "document", actor: Actor, contactId: string, media?: { key: string; mime: string; size: number; filename: string }, campaignRecipientId?: string) => withConnectionLock(channel, async tx => {
  const previous = await tx.officialSendCommand.findFirst({ where: { organizationId: channel.organizationId, idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.requestHash !== requestHash) throw conflict("OFFICIAL_IDEMPOTENCY_CONFLICT", "Esta chave já foi usada com outro envio");
    return previous.id;
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-connection:${channel.organizationId}:${channel.id}`}, 0))::text`;
  const active = await tx.channelConnection.findFirst({ where: { organizationId: channel.organizationId, id: channel.id, status: "connected", disabledAt: null, tokenEnc: { not: null }, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }] }, select: { id: true } });
  if (!active) throw httpError(422, "OFFICIAL_CONNECTION_DISABLED", "A conexão oficial está desativada ou expirada");
  if (campaignRecipientId) await checkSubmission(tx, channel.organizationId, campaignRecipientId);
  const thread = await tx.conversation.upsert({
    where: { connectionId_messagingContactId: { connectionId: channel.id, messagingContactId: contactId } },
    create: { organizationId: channel.organizationId, connectionId: channel.id, messagingContactId: contactId, chatid: `contact:${contactId}` }, update: {},
  });
  const id = randomUUID();
  const message = await tx.whatsappMessage.create({ data: {
    organizationId: channel.organizationId, connectionId: channel.id, conversationId: thread.id,
    providerId: `command:${id}`, origin: "cloud_api", direction: "outbound", type, text, rawType: input.type,
    status: "pending", sentByApi: true, sentById: actor.id, sentAt: new Date(),
    recipientIdentity: { identityId: input.identityId }, quotedId: typeof payload.context === "object" && payload.context && "message_id" in payload.context ? String(payload.context.message_id) : undefined,
    ...(media ? { mediaKey: media.key, mediaMime: media.mime, mediaSize: media.size, mediaFilename: media.filename, mediaStatus: "ready" } : {}),
  } });
  await tx.officialSendCommand.create({ data: {
    id, organizationId: channel.organizationId, connectionId: channel.id, messageId: message.id, actorUserId: actor.id,
    identityId: input.identityId, idempotencyKey: input.idempotencyKey, requestHash, request: input as Prisma.InputJsonObject, payload,
    campaignRecipientId,
  } });
  await recordAudit({ orgId: channel.organizationId, entityType: "WHATSAPP_MESSAGE", entityId: message.id, action: "MESSAGE_SENT", actor, context: { commandId: id, connectionId: channel.id, status: "pending" } }, tx);
  return id;
});

export const claim = async (orgId: string, id: string) => {
  const leaseToken = randomUUID();
  const result = await prisma.officialSendCommand.updateMany({ where: { organizationId: orgId, id, status: "pending" }, data: { status: "preparing", leaseToken, leaseExpiresAt: new Date(Date.now() + 120_000) } });
  return result.count ? leaseToken : null;
};
export const markSending = (orgId: string, id: string, leaseToken: string) => prisma.$transaction(async tx => {
  const command = await tx.officialSendCommand.findFirst({ where: { organizationId: orgId, id }, select: { connectionId: true, campaignRecipientId: true, campaignRecipient: { select: { campaignId: true } } } });
  if (!command) return false;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-connection:${orgId}:${command.connectionId}`}, 0))::text`;
  const channel = await tx.channelConnection.findFirst({ where: { organizationId: orgId, id: command.connectionId, status: "connected", disabledAt: null, tokenEnc: { not: null }, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }] }, select: { id: true } });
  if (!channel) throw httpError(422, "OFFICIAL_CONNECTION_DISABLED", "A conexão oficial está desativada ou expirada");
  if (command?.campaignRecipientId) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${command.campaignRecipient!.campaignId}`}, 0))`;
    await checkSubmission(tx, orgId, command.campaignRecipientId);
  }
  return (await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, id, status: "preparing", leaseToken, leaseExpiresAt: { gt: new Date() } }, data: { status: "sending", leaseExpiresAt: new Date(Date.now() + 120_000) } })).count > 0;
});
// Uma resposta tardia ainda é evidência após expirar a lease; o estado incerto nunca é reenviado.
export const recordResponse = (orgId: string, id: string, leaseToken: string, externalMessageId: string) => prisma.officialSendCommand.updateMany({ where: { organizationId: orgId, id, OR: [{ status: "sending", leaseToken }, { status: "uncertain", externalMessageId: null }] }, data: { externalMessageId } });
export const claimReconciliation = async (orgId: string, id: string) => {
  const leaseToken = randomUUID();
  const result = await prisma.officialSendCommand.updateMany({ where: { organizationId: orgId, id, status: "uncertain", externalMessageId: { not: null }, OR: [{ leaseToken: null }, { leaseExpiresAt: { lte: new Date() } }] }, data: { leaseToken, leaseExpiresAt: new Date(Date.now() + 120_000) } });
  return result.count ? leaseToken : null;
};
export const finishFailure = (orgId: string, id: string, leaseToken: string, uncertain: boolean, safeError: string, providerErrorCode: number | null) => prisma.$transaction(async tx => {
  const result = await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, id, leaseToken, status: { in: ["preparing", "sending"] } }, data: { status: uncertain ? "uncertain" : "failed", safeError, providerErrorCode, leaseToken: null, leaseExpiresAt: null } });
  if (result.count && !uncertain) {
    const saved = await tx.officialSendCommand.findFirst({ where: { organizationId: orgId, id } });
    if (saved) await tx.whatsappMessage.updateMany({ where: { organizationId: orgId, id: saved.messageId, status: "pending" }, data: { status: "failed" } });
  }
});

export const accept = (channel: ChannelConnection, id: string, leaseToken: string, externalMessageId: string) => withConnectionLock(channel, async tx => {
  const saved = await tx.officialSendCommand.findFirst({ where: { organizationId: channel.organizationId, id, leaseToken, status: { in: ["sending", "uncertain"] } } });
  if (!saved) throw conflict("OFFICIAL_COMMAND_LEASE", "O envio exige conciliação");
  const local = await tx.whatsappMessage.findFirst({ where: { organizationId: channel.organizationId, id: saved.messageId } });
  if (!local) throw notFound("Mensagem não encontrada");
  const echo = await tx.whatsappMessage.findFirst({ where: { organizationId: channel.organizationId, connectionId: channel.id, providerMessageId: externalMessageId }, include: { officialCommand: { select: { id: true } } } });
  if (echo && echo.id !== local.id) {
    if (echo.conversationId !== local.conversationId || echo.direction !== "outbound" || echo.sentById || echo.officialCommand) throw httpError(409, "OFFICIAL_MESSAGE_CONFLICT", "O ID externo exige revisão");
    await tx.whatsappMessage.deleteMany({ where: { organizationId: channel.organizationId, id: echo.id } });
  }
  await tx.whatsappMessage.updateMany({ where: { organizationId: channel.organizationId, id: local.id }, data: { providerId: externalMessageId, providerMessageId: externalMessageId, status: "sent", sentAt: new Date() } });
  await tx.officialSendCommand.updateMany({ where: { organizationId: channel.organizationId, id, leaseToken }, data: { status: "accepted", externalMessageId, safeError: null, leaseToken: null, leaseExpiresAt: null } });
  await tx.conversation.updateMany({ where: { organizationId: channel.organizationId, id: local.conversationId }, data: { lastMessageAt: new Date(), lastMessageText: local.text } });
  await reconcileReceipts(tx, channel, externalMessageId);
});

// Descoberta global contém apenas referências; a execução volta ao escopo da imobiliária.
export const recover = async () => {
  await prisma.officialSendCommand.updateMany({ where: { status: "preparing", leaseExpiresAt: { lte: new Date() } }, data: { status: "pending", leaseToken: null, leaseExpiresAt: null } });
  await prisma.officialSendCommand.updateMany({ where: { status: "sending", leaseExpiresAt: { lte: new Date() } }, data: { status: "uncertain", safeError: "A resposta da Meta não foi confirmada; não reenviar automaticamente", leaseToken: null, leaseExpiresAt: null } });
  return prisma.officialSendCommand.findMany({ where: { status: "pending", campaignRecipientId: null }, select: { id: true, organizationId: true }, orderBy: { createdAt: "asc" }, take: 100 });
};
// Conciliar uma resposta já persistida não submete uma nova mensagem ao provedor.
export const knownResponses = () => prisma.officialSendCommand.findMany({ where: { status: "uncertain", externalMessageId: { not: null } }, select: { id: true, organizationId: true, connectionId: true, externalMessageId: true }, take: 100 });
