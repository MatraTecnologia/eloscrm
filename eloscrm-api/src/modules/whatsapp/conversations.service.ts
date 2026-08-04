import type { Prisma, WhatsappMessage } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { resolveMediaUrl } from "./media.service.js";
import type { ListConversationsQuery, ListMessagesQuery } from "./conversations.schema.js";

const conversationSelect = {
  id: true,
  chatid: true,
  phone: true,
  isGroup: true,
  waName: true,
  contactName: true,
  photoUrl: true,
  clientId: true,
  lastMessageAt: true,
  lastMessageText: true,
  unreadCount: true,
  archivedAt: true,
  createdAt: true,
  client: { select: { id: true, name: true, phone: true, status: true, temperature: true } },
} satisfies Prisma.ConversationSelect;

export const list = async (orgId: string, query: ListConversationsQuery) => {
  const where: Prisma.ConversationWhereInput = {
    organizationId: orgId,
    archivedAt: query.archived ? { not: null } : null,
  };
  if (query.unread) where.unreadCount = { gt: 0 };
  if (query.q) {
    where.OR = [
      { waName: { contains: query.q, mode: "insensitive" } },
      { contactName: { contains: query.q, mode: "insensitive" } },
      { phone: { contains: query.q } },
      { client: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  const items = await prisma.conversation.findMany({
    where,
    select: conversationSelect,
    // conversa sem mensagem ainda não deveria existir, mas nulo por último evita que ela suma
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: query.limit,
    ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
  });

  return { items, nextCursor: items.length === query.limit ? items.at(-1)?.id : undefined };
};

export const getById = async (orgId: string, id: string) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: orgId },
    select: conversationSelect,
  });
  if (!conversation) throw notFound("Conversa não encontrada");
  return conversation;
};

/**
 * A URL da mídia é resolvida aqui e vai junto da mensagem: assinar é computação local, sem I/O,
 * então embutir sai mais barato que o front pedir uma por bolha. O TTL é curto — o front que
 * recarregar a página ganha URL nova.
 */
const serializeMessage = async (message: WhatsappMessage) => {
  const media = await resolveMediaUrl(message);
  const { mediaKey: _key, mediaTempUrl: _tmp, ...rest } = message;
  return { ...rest, mediaUrl: media?.url ?? null, mediaSource: media?.source ?? null };
};

export const listMessages = async (orgId: string, id: string, query: ListMessagesQuery) => {
  await getById(orgId, id);

  const messages = await prisma.whatsappMessage.findMany({
    where: { conversationId: id },
    orderBy: { sentAt: "desc" },
    take: query.limit,
    ...(query.before ? { skip: 1, cursor: { id: query.before } } : {}),
  });

  // o cursor da próxima página é a mensagem mais antiga deste lote — capturado antes de inverter,
  // porque depender da ordem de avaliação com um `reverse()` que muta o array é convite a bug
  const maisAntiga = messages.at(-1)?.id;

  return {
    // desc na query para pegar as mais recentes; asc na resposta porque a thread lê de cima
    items: await Promise.all([...messages].reverse().map(serializeMessage)),
    nextBefore: messages.length === query.limit ? maisAntiga : undefined,
  };
};

export const markRead = async (orgId: string, id: string) => {
  await getById(orgId, id);
  await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  return { ok: true };
};

export const mediaUrl = async (orgId: string, messageId: string) => {
  const message = await prisma.whatsappMessage.findFirst({
    where: { id: messageId, organizationId: orgId },
  });
  if (!message) throw notFound("Mensagem não encontrada");
  const media = await resolveMediaUrl(message);
  if (!media) throw notFound("Mídia indisponível");
  return media;
};

export const archive = async (orgId: string, id: string, archived: boolean) => {
  await getById(orgId, id);
  await prisma.conversation.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  return { ok: true };
};
