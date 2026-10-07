import { prisma } from "../../lib/prisma.js";
import { conflict } from "../../lib/http-error.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import type { WhatsappMessage } from "../../generated/prisma/client.js";

export const reserve = (orgId: string, conversationId: string, connectionId: string, input: { idempotencyKey: string; text: string }, actor: Actor) => prisma.$transaction(async tx => {
  const providerId = `uazapi-manual:${input.idempotencyKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgId}:${conversationId}:${providerId}`}, 0))`;
  const existing = await tx.whatsappMessage.findFirst({ where: { organizationId: orgId, conversationId, providerId } });
  if (existing) {
    if (existing.text !== input.text || existing.sentById !== actor.id) throw conflict("UAZAPI_REQUEST_CONFLICT", "Esta solicitação já foi usada com outro conteúdo ou atendente");
    return { message: existing, created: false };
  }
  const message = await tx.whatsappMessage.create({ data: { organizationId: orgId, conversationId, connectionId, providerId, origin: "uazapi", direction: "outbound", type: "text", text: input.text, status: "pending", rawType: "uazapi_manual_uncertain", sentByApi: true, sentById: actor.id, sentAt: new Date() } });
  await tx.conversation.updateMany({ where: { organizationId: orgId, id: conversationId }, data: { lastMessageAt: message.sentAt, lastMessageText: message.text } });
  await recordAudit({ orgId, entityType: "WHATSAPP_MESSAGE", entityId: message.id, action: "CREATED", actor, context: { conversationId, connectionId, provider: "uazapi", mode: "manual_exception" } }, tx);
  return { message, created: true };
});

export const settle = (orgId: string, id: string, result: { status: "sent" | "failed" | "pending"; providerMessageId?: string }, actor: Actor) => prisma.$transaction(async tx => {
  const message = await tx.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId, id, origin: "uazapi" } });
  const updated = await tx.whatsappMessage.update({ where: { id }, data: { ...result, rawType: result.status === "pending" ? "uazapi_manual_uncertain" : result.status === "failed" ? "uazapi_manual_failed" : "uazapi_manual_sent" } });
  if (result.status === "sent") await recordAudit({ orgId, entityType: "WHATSAPP_MESSAGE", entityId: id, action: "MESSAGE_SENT", actor, context: { conversationId: message.conversationId, connectionId: message.connectionId, provider: "uazapi", mode: "manual_exception" } }, tx);
  return updated;
});

export const resultOf = (message: Pick<WhatsappMessage, "id" | "status" | "rawType">) => ({
  id: message.id,
  status: message.rawType === "uazapi_manual_uncertain" ? "uncertain" : message.status === "failed" ? "failed" : "sent",
  safeError: message.rawType === "uazapi_manual_uncertain" ? "A uazapi não confirmou o resultado. Confira o WhatsApp antes de preparar outro envio; esta solicitação não será reenviada." : message.status === "failed" ? "A uazapi recusou o envio para este contato" : null,
});
