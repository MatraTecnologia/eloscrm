import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../../lib/audit.js";
import { AUTOMATION_ACTOR } from "../../lib/actor.js";
import { autoDealTitle } from "../../lib/deal-title.js";
import { isAutoNamed } from "../../lib/lead-name.js";
import { formatBrPhone, phoneKey } from "../../lib/phone.js";
import { openDealsByOwner } from "./assignment.service.js";

export const process = (orgId: string, messageId: string) => prisma.$transaction(async tx => {
  // Somente mensagens oficiais recebidas ao vivo criam leads e negócios.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inbound-automation:${orgId}`}, 0))::text`;
  const message = await tx.whatsappMessage.findFirst({ where: { organizationId: orgId, id: messageId, automationStatus: { in: ["pending", "failed"] }, automationNextAttemptAt: { lte: new Date() } }, include: { conversation: { include: { messagingContact: true } } } });
  if (!message) return;
  const conversation = message.conversation;
  const finish = (status: "processed" | "skipped", code?: string) => tx.whatsappMessage.updateMany({ where: { organizationId: orgId, id: messageId }, data: { automationStatus: status, automationProcessedAt: new Date(), automationErrorCode: code ?? null, automationSuggestedName: null, automationAttempts: { increment: 1 } } });
  if (conversation.isGroup || (message.origin !== "cloud_api" || message.direction !== "inbound" || !message.liveReceivedAt)) return finish("skipped", "AUTOMATION_NOT_LIVE");
  await tx.$queryRaw`SELECT "id" FROM "LeadAutomation" WHERE "organizationId" = ${orgId} FOR UPDATE`;
  const config = await tx.leadAutomation.findUnique({ where: { organizationId: orgId }, include: { members: { where: { active: true } } } });
  if (!config) return finish("skipped", "AUTOMATION_DISABLED");
  let clientId = conversation.clientId ?? conversation.messagingContact?.clientId ?? null;
  const key = phoneKey(conversation.phone);
  if (!clientId && key) {
    const candidates = await tx.client.findMany({ where: { organizationId: orgId, phoneKey: key }, select: { id: true }, take: 2 });
    if (candidates.length > 1) return finish("skipped", "AUTOMATION_AMBIGUOUS_PHONE");
    clientId = candidates[0]?.id ?? null;
  }
  let client = clientId ? await tx.client.findFirst({ where: { organizationId: orgId, id: clientId } }) : null;
  if (clientId && !client) return finish("skipped", "AUTOMATION_CLIENT_UNAVAILABLE");
  if (!client && !config.autoCreateClient) return finish("skipped", "AUTOMATION_CLIENT_DISABLED");
  let ownerId = client?.ownerId ?? null;
  if (!ownerId && config.autoAssign) {
    // Usa o mesmo lock e critério da roleta existente, incluindo a elegibilidade atual do membro.
    const members = await tx.member.findMany({ where: { organizationId: orgId, userId: { in: config.members.map(member => member.userId) } }, select: { userId: true } });
    const eligible = new Set(members.map(member => member.userId)); const loads = await openDealsByOwner(orgId, tx);
    const choices = config.members.filter(member => eligible.has(member.userId)).sort((left, right) => (loads.get(left.userId) ?? 0) - (loads.get(right.userId) ?? 0) || (left.lastAssignedAt?.getTime() ?? 0) - (right.lastAssignedAt?.getTime() ?? 0) || left.userId.localeCompare(right.userId));
    ownerId = choices[0]?.userId ?? null;
    if (ownerId) await tx.leadAutomationMember.update({ where: { automationId_userId: { automationId: config.id, userId: ownerId } }, data: { lastAssignedAt: new Date() } });
  }
  const suggested = message.automationSuggestedName?.trim() || conversation.messagingContact?.displayName?.trim() || conversation.contactName?.trim() || conversation.waName?.trim();
  if (!client) {
    const phone = formatBrPhone(conversation.phone);
    client = await tx.client.create({ data: { organizationId: orgId, name: suggested || phone || "Contato do WhatsApp", phone, phoneKey: key, source: "WHATSAPP", ownerId } });
    await recordAudit({ orgId, entityType: "CLIENT", entityId: client.id, action: "CREATED", actor: AUTOMATION_ACTOR, context: { messageId, conversationId: conversation.id, origin: message.origin } }, tx);
  } else if ((suggested && isAutoNamed(client) && client.name !== suggested) || (!client.ownerId && ownerId)) {
    const previousName = client.name;
    client = await tx.client.update({ where: { id: client.id }, data: { ...(suggested && isAutoNamed(client) ? { name: suggested } : {}), ...(!client.ownerId && ownerId ? { ownerId } : {}) } });
    await recordAudit({ orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED", actor: AUTOMATION_ACTOR, context: { messageId, operation: "inbound_automation" } }, tx);
    if (client.name !== previousName) {
      const previousTitle = autoDealTitle(previousName); const nextTitle = autoDealTitle(client.name);
      const cards = await tx.deal.findMany({ where: { organizationId: orgId, clientId: client.id, title: previousTitle }, select: { id: true } });
      for (const card of cards) {
        await tx.deal.updateMany({ where: { organizationId: orgId, id: card.id, title: previousTitle }, data: { title: nextTitle } });
        await recordAudit({ orgId, entityType: "DEAL", entityId: card.id, action: "UPDATED", actor: AUTOMATION_ACTOR, changes: { title: { from: previousTitle, to: nextTitle } } }, tx);
      }
    }
  }
  // Vínculo ao lead permite agregar atendimentos; não funde identidades de contatos diferentes.
  await tx.conversation.updateMany({ where: { organizationId: orgId, id: conversation.id }, data: { clientId: client.id } });
  if (conversation.messagingContactId && !conversation.messagingContact?.clientId) {
    const existingContact = await tx.messagingContact.findFirst({ where: { organizationId: orgId, clientId: client.id }, select: { id: true } });
    if (!existingContact) await tx.messagingContact.updateMany({ where: { organizationId: orgId, id: conversation.messagingContactId, clientId: null }, data: { clientId: client.id } });
  }
  if (config.autoCreateDeal && config.pipelineId && config.stageId) {
    const stage = await tx.stage.findFirst({ where: { organizationId: orgId, id: config.stageId, pipelineId: config.pipelineId }, select: { id: true } });
    const existing = await tx.deal.findFirst({ where: { organizationId: orgId, clientId: client.id, client: { status: { not: "NURTURING" } } }, select: { id: true } });
    if (stage && !existing) {
      const deal = await tx.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: config.pipelineId, stageId: stage.id, ownerId, title: autoDealTitle(client.name) } });
      if (client.status === "NURTURING") await tx.client.update({ where: { id: client.id }, data: { status: "ACTIVE", nurtureReason: null, nurtureNote: null, nurtureUntil: null, nurturedAt: null } });
      await recordAudit({ orgId, entityType: "DEAL", entityId: deal.id, action: "CREATED", actor: AUTOMATION_ACTOR, context: { messageId, clientId: client.id, operation: "inbound_automation" } }, tx);
    }
  }
  return finish("processed");
}, { timeout: 30_000, maxWait: 30_000 });

export const failed = (orgId: string, messageId: string) => prisma.whatsappMessage.updateMany({ where: { organizationId: orgId, id: messageId, automationStatus: { in: ["pending", "failed"] } }, data: { automationStatus: "failed", automationAttempts: { increment: 1 }, automationErrorCode: "AUTOMATION_PROCESSING_FAILED", automationNextAttemptAt: new Date(Date.now() + 60_000) } });
export const due = () => prisma.whatsappMessage.findMany({ where: { automationStatus: { in: ["pending", "failed"] }, automationAttempts: { lt: 10 }, automationNextAttemptAt: { lte: new Date() } }, select: { id: true, organizationId: true }, orderBy: [{ automationNextAttemptAt: "asc" }, { id: "asc" }], take: 100 });
export const list = (orgId: string) => prisma.whatsappMessage.findMany({ where: { organizationId: orgId, automationStatus: { not: null } }, select: { id: true, origin: true, automationStatus: true, automationAttempts: true, automationErrorCode: true, automationProcessedAt: true, createdAt: true, conversation: { select: { contactName: true, waName: true, client: { select: { name: true } }, messagingContact: { select: { displayName: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
export const retry = (orgId: string, messageId: string) => prisma.whatsappMessage.updateMany({ where: { organizationId: orgId, id: messageId, automationStatus: "failed" }, data: { automationStatus: "pending", automationAttempts: 0, automationNextAttemptAt: new Date(), automationErrorCode: null } });
