import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, notFound } from "../../lib/http-error.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import type { CampaignInput } from "./campaigns.schema.js";
import type { CampaignPreview } from "./preview.service.js";

export const contact = (orgId: string, clientId: string, scope: string) => prisma.messagingContact.findFirst({ where: { organizationId: orgId, OR: [{ clientId }, { conversations: { some: { organizationId: orgId, clientId } } }], identities: { some: { organizationId: orgId, scope, source: "provider", validFrom: { lte: new Date() }, validUntil: null } } }, orderBy: { id: "asc" }, select: { id: true, identities: { where: { organizationId: orgId, scope, source: "provider", validFrom: { lte: new Date() }, validUntil: null }, orderBy: [{ kind: "asc" }, { id: "asc" }] } } });
export const replyThreads = (orgId: string, clients: string[]) => prisma.conversation.findMany({ where: { organizationId: orgId, isGroup: false, OR: [{ clientId: { in: clients } }, { messagingContact: { organizationId: orgId, clientId: { in: clients } } }] }, select: { clientId: true, messagingContact: { select: { clientId: true } }, messages: { where: { origin: { not: "history" }, deletedAt: null }, orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: 1, select: { direction: true, sentAt: true } } } });
export const campaign = (orgId: string, id: string) => prisma.officialCampaign.findFirst({ where: { organizationId: orgId, id }, include: { recipients: { orderBy: { id: "asc" }, include: { command: { select: { id: true, messageId: true, externalMessageId: true, providerErrorCode: true, status: true, safeError: true, message: { select: { status: true, cost: { select: { amount: true, currency: true, state: true } } } } } } } } } });
export const existing = (orgId: string, idempotencyKey: string) => prisma.officialCampaign.findFirst({ where: { organizationId: orgId, idempotencyKey }, select: { id: true, requestHash: true } });
export const list = (orgId: string, pipelineId: string) => prisma.officialCampaign.findMany({ where: { organizationId: orgId, pipelineId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, name: true, connectionId: true, status: true, createdAt: true } });
const recipientData = (snapshot: CampaignPreview, orgId: string) => snapshot.rows.filter(row => !row.exclusion).map(row => ({ organizationId: orgId, clientId: row.clientId, dealId: row.dealId, clientName: row.clientName, contactId: row.contactId!, identityId: row.identityId!, identityHash: row.identityHash!, parameters: row.parameters as Prisma.InputJsonObject, costSnapshot: row.cost as Prisma.InputJsonObject }));
export const create = (orgId: string, input: CampaignInput, snapshot: CampaignPreview, meta: { name: string; idempotencyKey: string; requestHash: string }, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-create:${orgId}:${meta.idempotencyKey}`}, 0))`;
  const previous = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, idempotencyKey: meta.idempotencyKey } });
  if (previous) {
    if (previous.requestHash !== meta.requestHash) throw conflict("CAMPAIGN_IDEMPOTENCY", "Esta chave já foi usada em outra campanha");
    return previous.id;
  }
  const saved = await tx.officialCampaign.create({ data: { organizationId: orgId, connectionId: input.connectionId, pipelineId: input.pipelineId, actorUserId: actor.id, actorName: actor.name, ...meta, input: input as Prisma.InputJsonObject, snapshot: snapshot as unknown as Prisma.InputJsonObject, previewHash: snapshot.previewHash } });
  await tx.officialCampaignRecipient.createMany({ data: recipientData(snapshot, orgId).map(row => ({ ...row, campaignId: saved.id })) });
  await recordAudit({ orgId, actor, entityType: "BROADCAST", entityId: saved.id, entityLabel: saved.name, action: "CREATED", context: { connectionId: saved.connectionId, eligible: snapshot.eligible, status: "draft" } }, tx);
  return saved.id;
});
export const updateDraft = (orgId: string, id: string, snapshot: CampaignPreview, start: boolean, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${id}`}, 0))`;
  const saved = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, id } });
  if (!saved) throw notFound("Campanha não encontrada");
  if (!["draft", "needs_review"].includes(saved.status)) throw conflict("CAMPAIGN_STATE", "A campanha já foi iniciada ou cancelada");
  // Recomeçar uma campanha parcialmente enviada criaria outra intenção. A revisão só antecede o primeiro envio.
  if (await tx.officialCampaignRecipient.count({ where: { organizationId: orgId, campaignId: id, command: { isNot: null } } })) throw conflict("CAMPAIGN_PARTIAL", "Esta campanha já possui envios; crie outra campanha para os destinatários restantes");
  if (start && saved.previewHash !== snapshot.previewHash) throw conflict("CAMPAIGN_CHANGED", "Público, template ou custo mudou. Revise e salve a nova previsão antes de iniciar");
  await tx.officialCampaignRecipient.deleteMany({ where: { organizationId: orgId, campaignId: id } });
  await tx.officialCampaignRecipient.createMany({ data: recipientData(snapshot, orgId).map(row => ({ ...row, campaignId: id })) });
  await tx.officialCampaign.updateMany({ where: { organizationId: orgId, id }, data: { snapshot: snapshot as unknown as Prisma.InputJsonObject, previewHash: snapshot.previewHash, status: start ? "running" : "draft", nextAt: new Date() } });
  await recordAudit({ orgId, actor, entityType: "BROADCAST", entityId: id, action: "UPDATED", context: { status: start ? "running" : "draft", previewHash: snapshot.previewHash } }, tx);
});
export const cancel = (orgId: string, id: string, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${id}`}, 0))`;
  const saved = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, id } });
  if (!saved) throw notFound("Campanha não encontrada");
  if (saved.status === "canceled") return;
  await tx.officialCampaign.updateMany({ where: { organizationId: orgId, id }, data: { status: "canceled" } });
  const canceledCommands = await tx.officialSendCommand.findMany({ where: { organizationId: orgId, campaignRecipient: { campaignId: id }, status: { in: ["pending", "preparing"] } }, select: { id: true, messageId: true } });
  if (canceledCommands.length) {
    await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, id: { in: canceledCommands.map(value => value.id) }, status: { in: ["pending", "preparing"] } }, data: { status: "failed", safeError: "Campanha cancelada", leaseToken: null, leaseExpiresAt: null } });
    await tx.whatsappMessage.updateMany({ where: { organizationId: orgId, id: { in: canceledCommands.map(value => value.messageId) }, status: "pending" }, data: { status: "failed" } });
  }
  await tx.officialCampaignRecipient.updateMany({ where: { organizationId: orgId, campaignId: id, status: { in: ["pending", "preparing"] }, OR: [{ command: null }, { command: { id: { in: canceledCommands.map(value => value.id) } } }] }, data: { status: "skipped", safeError: "Campanha cancelada", leaseToken: null, leaseExpiresAt: null } });
  await recordAudit({ orgId, actor, entityType: "BROADCAST", entityId: id, action: "CANCELED", context: { connectionId: saved.connectionId } }, tx);
});
export const pause = (orgId: string, id: string) => prisma.officialCampaign.updateMany({ where: { organizationId: orgId, id, status: "running" }, data: { status: "needs_review" } });
export const transition = (orgId: string, id: string, status: "paused" | "running", actor: Actor) => prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${id}`}, 0))`;
  const saved = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, id } });
  if (!saved) throw notFound("Campanha não encontrada");
  if (!["running", "paused"].includes(saved.status)) throw conflict("CAMPAIGN_STATE", "Esta campanha não pode ser pausada ou retomada no estado atual");
  await tx.officialCampaign.updateMany({ where: { organizationId: orgId, id }, data: { status } });
  await recordAudit({ orgId, actor, entityType: "BROADCAST", entityId: id, action: "UPDATED", context: { status } }, tx);
});
export const recipient = (orgId: string, id: string) => prisma.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, id }, include: { campaign: true, command: { select: { id: true, status: true, safeError: true } } } });
export const settle = (orgId: string, id: string, leaseToken: string, status: string, safeError: string | null = null, failure?: { code: string | null; stage: string }) => prisma.$transaction(async tx => {
  const reference = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, id }, select: { campaignId: true, campaign: { select: { connectionId: true } } } });
  if (!reference) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-dispatch:${orgId}:${reference.campaign.connectionId}`}, 0))`;
  // O intervalo após concluir a tentativa e a liberação do slot são atômicos, inclusive em consultas lentas.
  await tx.officialCampaign.updateMany({ where: { organizationId: orgId, id: reference.campaignId }, data: { nextAt: new Date(Date.now() + 10000) } });
  return tx.officialCampaignRecipient.updateMany({ where: { organizationId: orgId, id, status: "preparing", leaseToken }, data: { status, safeError, errorCode: failure?.code, errorStage: failure?.stage, completedAt: status === "pending" ? null : new Date(), leaseToken: null, leaseExpiresAt: null } });
});
export const claim = (orgId: string, campaignId: string) => prisma.$transaction(async tx => {
  const saved = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, id: campaignId } });
  if (!saved) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-dispatch:${orgId}:${saved.connectionId}`}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${campaignId}`}, 0))`;
  const current = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, id: campaignId, status: "running", nextAt: { lte: new Date() } } });
  if (!current) return null;
  // Um slot por conexão. Jobs duplicados, múltiplas campanhas e múltiplos workers não formam rajada.
  const busy = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, campaign: { connectionId: saved.connectionId }, status: "preparing", leaseExpiresAt: { gt: new Date() } }, select: { id: true } });
  const recent = await tx.officialCampaign.findFirst({ where: { organizationId: orgId, connectionId: saved.connectionId, nextAt: { gt: new Date() } }, select: { id: true } });
  if (busy || recent) return null;
  const target = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, campaignId, OR: [{ status: "pending" }, { status: "preparing", leaseExpiresAt: { lte: new Date() } }] }, orderBy: { id: "asc" } });
  if (!target) {
    await tx.officialCampaign.updateMany({ where: { organizationId: orgId, id: campaignId, status: "running" }, data: { status: "done" } });
    return null;
  }
  const leaseToken = randomUUID();
  await tx.officialCampaignRecipient.updateMany({ where: { organizationId: orgId, id: target.id }, data: { status: "preparing", attempts: { increment: 1 }, startedAt: new Date(), leaseToken, leaseExpiresAt: new Date(Date.now() + 180000) } });
  await tx.officialCampaign.updateMany({ where: { organizationId: orgId, id: campaignId }, data: { nextAt: new Date(Date.now() + 10000) } });
  return { id: target.id, leaseToken };
});
// A descoberta global só retorna referências; todo processamento seguinte volta ao tenant.
export const pendingCampaigns = () => prisma.officialCampaign.findMany({ where: { status: "running" }, select: { id: true, organizationId: true }, take: 100, orderBy: { nextAt: "asc" } });

export const recipientIdentities = (orgId: string, ids: string[]) => prisma.contactIdentity.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, value: true } });
export const failedReceipts = (orgId: string, connectionId: string, ids: string[]) => prisma.officialDeliveryReceipt.findMany({ where: { organizationId: orgId, connectionId, externalMessageId: { in: ids }, status: "failed" }, orderBy: { occurredAt: "desc" }, select: { externalMessageId: true, errorCodes: true } });
