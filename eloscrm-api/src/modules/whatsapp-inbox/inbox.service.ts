import { httpError, notFound } from "../../lib/http-error.js";
import { serializeMessage } from "../whatsapp/conversations.service.js";
import { cursorSchema, type ListInput } from "./inbox.schema.js";
import * as repo from "./inbox.repo.js";
import type { Actor } from "../../lib/actor.js";

export const linkOfficial = (orgId: string, conversationId: string, clientId: string, actor: Actor) => repo.linkOfficial(orgId, conversationId, clientId, actor);

export const get = async (orgId: string, id: string) => {
  const conversations = await repo.children(orgId, id);
  if (!conversations.length) throw notFound("Atendimento não encontrado nesta imobiliária");
  const identities = await repo.identities(orgId, conversations.flatMap(conversation => conversation.messagingContactId ? [conversation.messagingContactId] : []));
  const primary = conversations[0]!;
  const client = primary.client ?? primary.messagingContact?.client;
  return { id, name: client?.name ?? primary.messagingContact?.displayName ?? primary.contactName ?? primary.waName ?? primary.phone ?? "Contato sem telefone", clientId: client?.id ?? null,
    unreadCount: conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
    archived: conversations.every(conversation => !!conversation.archivedAt), lastMessageAt: primary.lastMessageAt, lastMessageText: primary.lastMessageText,
    channels: conversations.map(conversation => ({
      conversationId: conversation.id, provider: conversation.connection?.provider ?? "uazapi" as const,
      connectionId: conversation.connectionId, label: conversation.connection?.label ?? conversation.instance?.name ?? "uazapi",
      number: conversation.connection?.displayPhoneNumber ?? conversation.instance?.ownerJid?.split("@")[0] ?? null,
      status: conversation.connection?.provider === "cloud_api" ? conversation.connection.status : conversation.instance?.status === "connected" ? "connected" : "disconnected",
      credentialExpired: !!conversation.connection?.tokenExpiresAt && conversation.connection.tokenExpiresAt <= new Date(),
      serviceWindowExpiresAt: conversation.serviceWindowExpiresAt, phone: conversation.phone, isGroup: conversation.isGroup,
      identities: identities.filter(identity => identity.contactId === conversation.messagingContactId && identity.scope === `business:${conversation.connection?.businessPortfolioId}`).map(identity => ({ id: identity.id, kind: identity.kind })),
    })),
  };
};
export const list = async (orgId: string, input: ListInput) => {
  let cursor: { id: string; at: string } | undefined;
  if (input.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString())); }
    catch { throw httpError(422, "INBOX_CURSOR_INVALID", "Cursor de atendimento inválido"); }
  }
  const rows = await repo.listGroups(orgId, input, cursor);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: await Promise.all(page.map(row => get(orgId, row.id))), nextCursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ id: last.id, at: last.at.toISOString() })).toString("base64url") : undefined };
};
export const messages = async (orgId: string, id: string, input: { before?: string; limit: number }) => {
  const group = await get(orgId, id);
  const ids = group.channels.map(channel => channel.conversationId);
  const cursor = input.before ? await repo.messageCursor(orgId, ids, input.before) : null;
  if (input.before && !cursor) throw notFound("Mensagem não encontrada neste atendimento");
  const rows = await repo.messages(orgId, ids, input.limit, cursor ?? undefined);
  const page = rows.slice(0, input.limit);
  const quotes = await repo.quotedMessages(orgId, page);
  return { items: await Promise.all([...page].reverse().map(async message => {
    const { officialCommand, sentBy, ...data } = message;
    const quoted = new Map(quotes.filter(quote => quote.conversationId === message.conversationId).map(({ conversationId: _id, ...quote }) => [quote.providerMessageId!, quote.deletedAt ? { ...quote, text: null, mediaThumb: null } : quote]));
    return { ...await serializeMessage(data, quoted), conversationId: message.conversationId, connectionId: message.connectionId, origin: message.origin, authorName: sentBy?.name ?? message.senderName, command: officialCommand };
  })), nextBefore: rows.length > input.limit ? page.at(-1)?.id : undefined };
};
export const read = async (orgId: string, id: string) => { await get(orgId, id); await repo.read(orgId, id); return { ok: true }; };
