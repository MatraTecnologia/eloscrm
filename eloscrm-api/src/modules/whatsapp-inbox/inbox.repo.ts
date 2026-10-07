import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, notFound } from "../../lib/http-error.js";
import { deleteFiles, R2_PRIVATE_BUCKET } from "../../lib/storage.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import type { ListInput } from "./inbox.schema.js";

export const listGroups = (orgId: string, input: ListInput, cursor?: { id: string; at: string }) => prisma.$queryRaw<{ id: string; at: Date }[]>(Prisma.sql`
  WITH entries AS (
    SELECT CASE WHEN c."isGroup" THEN 'conversation:' || c.id
      WHEN COALESCE(c."clientId", mc."clientId") IS NOT NULL THEN 'client:' || COALESCE(c."clientId", mc."clientId")
      WHEN c."messagingContactId" IS NOT NULL THEN 'contact:' || c."messagingContactId"
      ELSE 'conversation:' || c.id END AS id,
      COALESCE(c."lastMessageAt", c."createdAt") AS at, c."unreadCount", c."archivedAt",
      COALESCE(cl.name, mc."displayName", c."contactName", c."waName", c.phone, '') AS name, COALESCE(c.phone, '') AS phone
    FROM "Conversation" c
    LEFT JOIN "MessagingContact" mc ON mc.id = c."messagingContactId" AND mc."organizationId" = c."organizationId"
    LEFT JOIN "Client" cl ON cl.id = COALESCE(c."clientId", mc."clientId") AND cl."organizationId" = c."organizationId"
    WHERE c."organizationId" = ${orgId} AND (c."instanceId" IS NOT NULL OR c."connectionId" IS NOT NULL)
  ), groups AS (
    SELECT id, MAX(at) AS at FROM entries GROUP BY id
    HAVING ${input.clientId && input.filter === "all" ? Prisma.sql`TRUE` : input.filter === "archived" ? Prisma.sql`BOOL_AND("archivedAt" IS NOT NULL)` : Prisma.sql`BOOL_OR("archivedAt" IS NULL)`}
      ${input.filter === "unread" ? Prisma.sql`AND SUM("unreadCount") > 0` : Prisma.empty}
      ${input.clientId ? Prisma.sql`AND id = ${`client:${input.clientId}`}` : Prisma.empty}
      ${input.q ? Prisma.sql`AND BOOL_OR(position(lower(${input.q}) in lower(name || ' ' || phone)) > 0)` : Prisma.empty}
  ) SELECT id, at FROM groups
    ${cursor ? Prisma.sql`WHERE (at, id) < (${new Date(cursor.at)}, ${cursor.id})` : Prisma.empty}
    ORDER BY at DESC, id DESC LIMIT ${input.limit + 1}
`);

export const childWhere = (orgId: string, groupId: string): Prisma.ConversationWhereInput => {
  const [kind, id] = groupId.split(":");
  return { organizationId: orgId, OR: [{ instanceId: { not: null } }, { connectionId: { not: null } }],
    ...(kind === "client" ? { isGroup: false, AND: [{ OR: [{ clientId: id }, { clientId: null, messagingContact: { clientId: id, organizationId: orgId } }] }] }
      : kind === "contact" ? { isGroup: false, clientId: null, messagingContactId: id, messagingContact: { clientId: null, organizationId: orgId } }
      : { id, AND: [{ OR: [{ isGroup: true }, { clientId: null, messagingContactId: null }] }] }),
  };
};
export const children = (orgId: string, id: string) => prisma.conversation.findMany({
  where: childWhere(orgId, id), orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
  select: { id: true, clientId: true, phone: true, isGroup: true, waName: true, contactName: true, unreadCount: true, archivedAt: true, lastMessageAt: true, lastMessageText: true, serviceWindowExpiresAt: true, connectionId: true, messagingContactId: true,
    client: { select: { id: true, name: true } }, messagingContact: { select: { id: true, displayName: true, clientId: true, client: { select: { id: true, name: true } } } },
    connection: { select: { id: true, provider: true, label: true, displayPhoneNumber: true, businessPortfolioId: true, status: true, tokenExpiresAt: true } },
    instance: { select: { id: true, name: true, ownerJid: true, status: true } },
  },
});
export const identities = (orgId: string, contactIds: string[]) => prisma.contactIdentity.findMany({ where: { organizationId: orgId, contactId: { in: contactIds }, validUntil: null, validFrom: { lte: new Date() }, source: "provider", kind: { in: ["phone", "wa_id", "bsuid", "parent_bsuid"] } }, select: { id: true, kind: true, contactId: true, scope: true } });
export const messageCursor = (orgId: string, conversationIds: string[], id: string) => prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, conversationId: { in: conversationIds }, id }, select: { id: true, sentAt: true } });
export const messages = (orgId: string, conversationIds: string[], limit: number, cursor?: { id: string; sentAt: Date }, q?: string) => prisma.whatsappMessage.findMany({
  where: { organizationId: orgId, conversationId: { in: conversationIds }, type: { not: "reaction" }, ...(q ? { deletedAt: null, text: { contains: q, mode: "insensitive" as const } } : {}), ...(cursor ? { OR: [{ sentAt: { lt: cursor.sentAt } }, { sentAt: cursor.sentAt, id: { lt: cursor.id } }] } : {}) },
  include: { reactions: { orderBy: { reactedAt: "asc" } }, officialCommand: { select: { id: true, status: true, safeError: true } }, sentBy: { select: { name: true } } },
  orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: limit + 1,
});
export const quotedMessages = (orgId: string, references: { conversationId: string; quotedId: string | null }[]) => {
  const pairs = references.flatMap(message => message.quotedId ? [{ conversationId: message.conversationId, providerMessageId: message.quotedId }] : []);
  if (!pairs.length) return Promise.resolve([]);
  return prisma.whatsappMessage.findMany({ where: { organizationId: orgId, OR: pairs }, select: { conversationId: true, id: true, providerMessageId: true, direction: true, type: true, text: true, senderName: true, mediaThumb: true, deletedAt: true } });
};
export const read = (orgId: string, id: string) => prisma.conversation.updateMany({ where: childWhere(orgId, id), data: { unreadCount: 0 } });
export const linkOfficial = (orgId: string, conversationId: string, clientId: string, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inbox-link:${orgId}`}, 0))::text`;
  const conversation = await tx.conversation.findFirst({ where: { organizationId: orgId, id: conversationId, connectionId: { not: null }, instanceId: null } });
  const client = await tx.client.findFirst({ where: { organizationId: orgId, id: clientId }, select: { id: true } });
  if (!conversation?.messagingContactId || !client) throw notFound("Conversa ou lead não encontrado nesta imobiliária");
  const contact = await tx.messagingContact.findFirst({ where: { organizationId: orgId, id: conversation.messagingContactId } });
  if (!contact || (contact.clientId && contact.clientId !== clientId)) throw conflict("OFFICIAL_CONTACT_LINKED", "O contato já está vinculado a outro lead");
  const existing = await tx.messagingContact.findFirst({ where: { organizationId: orgId, clientId, id: { not: contact.id } }, select: { id: true } });
  if (existing) throw conflict("OFFICIAL_CLIENT_LINKED", "Este lead já possui outro contato oficial; revise as identidades antes de unir");
  await tx.messagingContact.updateMany({ where: { organizationId: orgId, id: contact.id }, data: { clientId } });
  await tx.conversation.updateMany({ where: { organizationId: orgId, messagingContactId: contact.id }, data: { clientId } });
  await recordAudit({ orgId, entityType: "CONVERSATION", entityId: conversationId, action: "LINKED", actor, context: { clientId, contactId: contact.id } }, tx);
  return { id: `client:${clientId}` };
});

export const archive = (orgId: string, id: string, archived: boolean, actor: Actor) => prisma.$transaction(async tx => {
  const conversations = await tx.conversation.findMany({ where: childWhere(orgId, id), select: { id: true } });
  if (!conversations.length) throw notFound("Atendimento não encontrado nesta imobiliária");
  await tx.conversation.updateMany({ where: childWhere(orgId, id), data: { archivedAt: archived ? new Date() : null } });
  for (const conversation of conversations) await recordAudit({ orgId, entityType: "CONVERSATION", entityId: conversation.id, action: archived ? "ARCHIVED" : "UNARCHIVED", actor }, tx);
  return { ok: true };
});

export const remove = (orgId: string, id: string, actor: Actor) => prisma.$transaction(async tx => {
  const conversations = await tx.conversation.findMany({ where: childWhere(orgId, id), select: { id: true, connection: { select: { businessPortfolioId: true } } } });
  if (!conversations.length) throw notFound("Atendimento não encontrado nesta imobiliária");
  for (const portfolio of [...new Set(conversations.flatMap(row => row.connection?.businessPortfolioId ? [row.connection.businessPortfolioId] : []))].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp:${orgId}:${portfolio}`}, 0))::text`;
  const ids = conversations.map(row => row.id);
  const active = await tx.officialSendCommand.count({ where: { organizationId: orgId, message: { conversationId: { in: ids } }, status: { in: ["pending", "preparing", "sending", "uncertain"] } } });
  if (active) throw conflict("INBOX_SEND_ACTIVE", "Há envios pendentes ou sem confirmação. Aguarde a conclusão antes de excluir.");
  const media = await tx.whatsappMessage.findMany({ where: { organizationId: orgId, conversationId: { in: ids }, mediaKey: { not: null } }, select: { mediaKey: true } });
  const keys = [...new Set(media.flatMap(row => row.mediaKey ? [row.mediaKey] : []))];
  const shared = await tx.whatsappMessage.findMany({ where: { organizationId: orgId, conversationId: { notIn: ids }, mediaKey: { in: keys } }, select: { mediaKey: true } });
  const sharedKeys = new Set(shared.map(row => row.mediaKey));
  await deleteFiles(R2_PRIVATE_BUCKET, keys.filter(key => !sharedKeys.has(key)));
  for (const conversation of conversations) await recordAudit({ orgId, entityType: "CONVERSATION", entityId: conversation.id, action: "DELETED", actor }, tx);
  // Mantém IDs para custos e auditoria, retirando conteúdo e vínculos do atendimento.
  await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, message: { conversationId: { in: ids } } }, data: { request: {}, payload: {}, payloadPurgedAt: new Date() } });
  await tx.whatsappReaction.deleteMany({ where: { message: { organizationId: orgId, conversationId: { in: ids } } } });
  await tx.whatsappMessage.updateMany({ where: { organizationId: orgId, conversationId: { in: ids } }, data: {
    text: null, senderName: null, senderLid: null, recipientIdentity: Prisma.DbNull, deletedAt: new Date(),
    mediaKey: null, mediaThumb: null, mediaTempUrl: null, mediaFilename: null, mediaWaveform: null,
    officialMediaId: null, mediaStatus: "none", mediaNextAttemptAt: null, mediaLeaseToken: null,
    poll: Prisma.DbNull, contacts: Prisma.DbNull, location: Prisma.DbNull, automationSuggestedName: null,
    automationStatus: "skipped", automationNextAttemptAt: null,
  } });
  for (const conversation of conversations) await tx.conversation.updateMany({ where: { organizationId: orgId, id: conversation.id }, data: {
    instanceId: null, connectionId: null, messagingContactId: null, clientId: null, chatid: conversation.id,
    phone: null, phoneKey: null, lid: null, waName: null, contactName: null, photoUrl: null,
    lastMessageText: null, unreadCount: 0, archivedAt: new Date(), serviceWindowExpiresAt: null,
  } });
  return { ok: true };
}, { timeout: 30_000 });
