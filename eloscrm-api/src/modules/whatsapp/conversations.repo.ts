import {
  WhatsappMediaStatus,
  type Prisma,
  type WhatsappMessage,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ParsedConversation, ParsedMessage } from "./message-envelope.js";

export const findConversation = (instanceId: string, chatid: string) =>
  prisma.conversation.findUnique({ where: { instanceId_chatid: { instanceId, chatid } } });

/**
 * Cria ou atualiza a conversa. Os campos de perfil (nome, foto) são reescritos a cada mensagem
 * porque a pessoa pode trocar de foto ou nome — mas `clientId` **não** entra aqui: o vínculo com o
 * lead é decisão do corretor e não pode ser desfeito por um evento.
 */
export const upsertConversation = (
  orgId: string,
  instanceId: string,
  parsed: ParsedConversation,
) => {
  const shared = {
    phone: parsed.phone,
    phoneKey: parsed.phoneKey,
    lid: parsed.lid,
    isGroup: parsed.isGroup,
    waName: parsed.waName,
    contactName: parsed.contactName,
    photoUrl: parsed.photoUrl,
  };
  return prisma.conversation.upsert({
    where: { instanceId_chatid: { instanceId, chatid: parsed.chatid } },
    create: { organizationId: orgId, instanceId, chatid: parsed.chatid, ...shared },
    update: shared,
  });
};

/**
 * Grava a mensagem, ignorando reentrega.
 *
 * `skipDuplicates` não serve aqui porque precisamos saber **se** criou: só mensagem nova mexe em
 * contador de não lidas e enfileira download de mídia. O webhook repete de verdade — a captura
 * desta integração foi feita sobre uma entrega que a uazapi tentou 10 vezes.
 */
export const createMessageIfNew = async (
  orgId: string,
  conversationId: string,
  parsed: ParsedMessage,
): Promise<WhatsappMessage | null> => {
  const existing = await prisma.whatsappMessage.findUnique({
    where: { conversationId_providerId: { conversationId, providerId: parsed.providerId } },
  });
  if (existing) return null;

  const data: Prisma.WhatsappMessageUncheckedCreateInput = {
    organizationId: orgId,
    conversationId,
    providerId: parsed.providerId,
    providerMessageId: parsed.providerMessageId,
    direction: parsed.direction,
    type: parsed.type,
    rawType: parsed.rawType,
    text: parsed.text,
    contacts: parsed.contacts ?? undefined,
    location: parsed.location ?? undefined,
    quotedId: parsed.quotedId,
    reactionTo: parsed.reactionTo,
    sentByApi: parsed.sentByApi,
    senderLid: parsed.senderLid,
    senderName: parsed.senderName,
    sentAt: parsed.sentAt,
    mediaStatus: parsed.hasMedia ? WhatsappMediaStatus.pending : WhatsappMediaStatus.none,
    mediaMime: parsed.mediaMime,
    mediaSize: parsed.mediaSize,
    mediaFilename: parsed.mediaFilename,
    mediaDuration: parsed.mediaDuration,
    mediaWidth: parsed.mediaWidth,
    mediaHeight: parsed.mediaHeight,
    mediaThumb: parsed.mediaThumb,
    mediaWaveform: parsed.mediaWaveform,
  };

  try {
    return await prisma.whatsappMessage.create({ data });
  } catch (err) {
    // corrida entre duas entregas do mesmo evento: a unique resolve, e o resultado é o desejado
    if ((err as { code?: string }).code === "P2002") return null;
    throw err;
  }
};

export const touchConversation = (
  id: string,
  data: { lastMessageAt: Date; lastMessageText: string | null; incrementUnread: boolean },
) =>
  prisma.conversation.update({
    where: { id },
    data: {
      lastMessageAt: data.lastMessageAt,
      lastMessageText: data.lastMessageText,
      ...(data.incrementUnread ? { unreadCount: { increment: 1 } } : {}),
    },
  });

export const linkClient = (id: string, clientId: string) =>
  prisma.conversation.update({ where: { id }, data: { clientId } });

export const findInstanceById = (id: string) =>
  prisma.uazapiInstance.findUnique({ where: { id } });
