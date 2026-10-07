import { Prisma, type ChannelConnection, type WhatsappMessageOrigin } from "../../generated/prisma/client.js";
import { parseOfficialMessage, profileFor } from "./message-parser.js";
import { resolveAliases, withConnectionLock } from "./identity.repo.js";
import { reconcileReceipts } from "./receipts.repo.js";
import { conflict } from "../../lib/http-error.js";
import { enqueueInboundAutomation } from "../lead-automation/inbound-automation.service.js";
import { enqueueOfficialMediaJob } from "./media.service.js";

export const ingestMessage = async (connection: ChannelConnection, raw: Record<string, unknown>, contacts: Record<string, unknown>[], origin: WhatsappMessageOrigin, receivedAt: Date, threadId?: string) => {
  const message = parseOfficialMessage(raw, origin, receivedAt, threadId);
  const profile = profileFor(contacts, message.aliases);
  const saved = await withConnectionLock(connection, async tx => {
    const contact = await resolveAliases(tx, connection, profile.aliases, profile.displayName, message.sentAt);
    const conversation = await tx.conversation.upsert({
      where: { connectionId_messagingContactId: { connectionId: connection.id, messagingContactId: contact.id } },
      create: {
        organizationId: connection.organizationId, connectionId: connection.id, messagingContactId: contact.id,
        chatid: message.aliases[0]!.value, waName: profile.displayName,
        phone: message.aliases.find(alias => alias.kind === "wa_id")?.value,
      }, update: {},
    });
    const where = { organizationId: connection.organizationId, connectionId: connection.id, providerMessageId: message.id };
    const existing = await tx.whatsappMessage.findFirst({ where });
    if (existing && (existing.conversationId !== conversation.id || existing.direction !== message.direction)) throw conflict("OFFICIAL_MESSAGE_CONFLICT", "A mensagem possui vínculo ou direção incompatível");
    const firstLiveInbound = origin === "cloud_api" && message.isCustomerMessage && !existing?.liveReceivedAt;
    const data = {
      type: message.type, rawType: message.rawType, text: message.text,
      officialMediaId: message.mediaId, mediaMime: message.mediaMime, mediaFilename: message.mediaFilename,
      quotedId: message.quotedId, location: message.location as Prisma.InputJsonObject | undefined,
      contacts: message.contacts as Prisma.InputJsonArray | undefined,
    };
    let messageId = existing?.id;
    if (!existing) {
      const created = await tx.whatsappMessage.create({ data: {
        ...data, organizationId: connection.organizationId, connectionId: connection.id, conversationId: conversation.id,
        providerId: message.id, providerMessageId: message.id, origin, direction: message.direction, sentAt: message.sentAt,
        recipientIdentity: profile.aliases as unknown as Prisma.InputJsonArray,
        liveReceivedAt: firstLiveInbound ? receivedAt : null,
        automationStatus: firstLiveInbound ? "pending" : null,
        automationNextAttemptAt: firstLiveInbound ? receivedAt : null,
        automationSuggestedName: firstLiveInbound ? profile.displayName : undefined,
        mediaStatus: message.mediaId ? "pending" : "none",
      } });
      messageId = created.id;
    } else {
      // Histórico/eco não sobrescrevem autoria ou conteúdo já conhecido do envio pelo CRM.
      const enrichment = existing.rawType === "media_placeholder" ? { ...data, ...(message.mediaId && !existing.mediaKey ? { mediaStatus: "pending" as const } : {}) } : {};
      await tx.whatsappMessage.updateMany({ where, data: {
        ...enrichment, ...(firstLiveInbound ? { liveReceivedAt: receivedAt, origin: "cloud_api", automationStatus: "pending", automationNextAttemptAt: receivedAt, automationSuggestedName: profile.displayName } : {}),
      } });
    }
    await tx.conversation.updateMany({
      where: { id: conversation.id, organizationId: connection.organizationId },
      data: {
        ...(firstLiveInbound ? { unreadCount: { increment: 1 } } : {}),
        ...(!conversation.lastMessageAt || message.sentAt >= conversation.lastMessageAt ? { lastMessageAt: message.sentAt, lastMessageText: existing && existing.rawType !== "media_placeholder" ? existing.text : message.text } : {}),
        ...(firstLiveInbound && (!conversation.lastCustomerMessageAt || message.sentAt > conversation.lastCustomerMessageAt) ? {
          lastCustomerMessageAt: message.sentAt, serviceWindowExpiresAt: new Date(message.sentAt.getTime() + 86_400_000),
        } : {}),
      },
    });
    await reconcileReceipts(tx, connection, message.id);
    return { conversationId: conversation.id, messageId: messageId!, firstLiveInbound, hasMedia: !!message.mediaId };
  });
  if (saved.firstLiveInbound) await enqueueInboundAutomation({ organizationId: connection.organizationId, messageId: saved.messageId }).catch(() => undefined);
  if (saved.hasMedia) await enqueueOfficialMediaJob({ organizationId: connection.organizationId, messageId: saved.messageId }).catch(() => undefined);
  return saved.conversationId;
};
