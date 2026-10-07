import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict } from "../../lib/http-error.js";

export const legacyConversations = (orgId: string, cursor?: string) => prisma.conversation.findMany({
  where: { organizationId: orgId, instanceId: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
  select: { id: true, isGroup: true, connectionId: true, messagingContactId: true }, orderBy: { id: "asc" }, take: 100,
});

// Só o vínculo de lead já persistido ou um alias exato da conexão prova identidade; phoneKey não participa.
export const linkUazapiConversationInTransaction = async (tx: Prisma.TransactionClient, orgId: string, conversationId: string, apply = true) => {
  const thread = await tx.conversation.findFirst({ where: { organizationId: orgId, id: conversationId }, include: { instance: true } });
  if (!thread?.instanceId || !thread.instance || thread.instance.organizationId !== orgId) return { id: conversationId, status: "unavailable" as const };
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`uazapi-history:${orgId}:${thread.instanceId}`}, 0))::text`;
  const connection = await tx.channelConnection.findFirst({ where: { organizationId: orgId, uazapiInstanceId: thread.instanceId, provider: "uazapi" } });
  if (thread.connectionId && thread.connectionId !== connection?.id) throw conflict("UAZAPI_HISTORY_CONNECTION_CONFLICT", "A conversa já pertence a outra conexão");
  const scope = connection ? `connection:${connection.id}` : null;
  const aliases = [{ kind: "jid" as const, value: thread.chatid }, ...(thread.lid ? [{ kind: "lid" as const, value: thread.lid }] : [])];
  const identities = scope && !thread.isGroup ? await tx.contactIdentity.findMany({ where: { organizationId: orgId, connectionId: connection!.id, scope, OR: aliases } }) : [];
  if (identities.some(identity => identity.validUntil)) throw conflict("UAZAPI_HISTORY_IDENTITY_RETIRED", "Uma identidade desta conversa exige revisão");
  const explicitClient = thread.clientId && !thread.isGroup ? await tx.client.findFirst({ where: { organizationId: orgId, id: thread.clientId }, select: { id: true } }) : null;
  if (thread.clientId && !thread.isGroup && !explicitClient) throw conflict("UAZAPI_HISTORY_CLIENT_CONFLICT", "O lead vinculado não pertence a esta imobiliária");
  const clientContact = explicitClient ? await tx.messagingContact.findFirst({ where: { organizationId: orgId, clientId: explicitClient.id } }) : null;
  const contactIds = [...new Set([thread.messagingContactId, clientContact?.id, ...identities.map(identity => identity.contactId)].filter((id): id is string => !!id))];
  if (contactIds.length > 1) throw conflict("UAZAPI_HISTORY_IDENTITY_CONFLICT", "Os vínculos desta conversa apontam para contatos diferentes");
  const contact = contactIds.length ? await tx.messagingContact.findFirst({ where: { organizationId: orgId, id: contactIds[0] } }) : null;
  if (contactIds.length && (!contact || (explicitClient && contact.clientId && contact.clientId !== explicitClient.id))) throw conflict("UAZAPI_HISTORY_CONTACT_CONFLICT", "O contato desta conversa exige revisão");
  if (contact && connection) {
    const duplicate = await tx.conversation.findFirst({ where: { organizationId: orgId, connectionId: connection.id, messagingContactId: contact.id, id: { not: conversationId } }, select: { id: true } });
    if (duplicate) throw conflict("UAZAPI_HISTORY_DUPLICATE_THREAD", "Duas conversas desta conexão apontam para o mesmo contato; revise os vínculos");
  }
  if (!apply) {
    const missingMessages = await tx.whatsappMessage.count({ where: { organizationId: orgId, conversationId, connectionId: null } });
    const complete = !!thread.connectionId && !missingMessages && (thread.isGroup ? !thread.messagingContactId : !!thread.messagingContactId && identities.length === aliases.length && (!explicitClient || contact?.clientId === explicitClient.id));
    return { id: conversationId, status: complete ? "linked" as const : "ready" as const, isGroup: thread.isGroup };
  }
  const channel = connection ?? await tx.channelConnection.create({ data: {
    organizationId: orgId, provider: "uazapi", label: thread.instance.profileName || "WhatsApp uazapi", uazapiInstanceId: thread.instanceId,
    status: thread.instance.status === "connected" ? "connected" : "disconnected",
  } });
  const person = thread.isGroup ? null : contact ?? await tx.messagingContact.create({ data: { organizationId: orgId, clientId: explicitClient?.id, displayName: thread.contactName || thread.waName } });
  if (person && explicitClient && !person.clientId) await tx.messagingContact.update({ where: { id: person.id, organizationId: orgId }, data: { clientId: explicitClient.id } });
  const addedAliases = person ? await tx.contactIdentity.createMany({ data: aliases.map(alias => ({ ...alias, organizationId: orgId, connectionId: channel.id, scope: `connection:${channel.id}`, contactId: person.id, source: "uazapi_history" })), skipDuplicates: true }) : { count: 0 };
  const changedThread = thread.connectionId !== channel.id || thread.messagingContactId !== (person?.id ?? null);
  if (changedThread) await tx.conversation.updateMany({ where: { organizationId: orgId, id: conversationId }, data: { connectionId: channel.id, messagingContactId: person?.id ?? null } });
  const messages = await tx.whatsappMessage.updateMany({ where: { organizationId: orgId, conversationId, connectionId: null }, data: { connectionId: channel.id } });
  return { id: conversationId, status: "linked" as const, isGroup: thread.isGroup, modified: changedThread || addedAliases.count > 0 || messages.count > 0 || !!(person && explicitClient && !person.clientId) };
};

export const linkUazapiConversation = (orgId: string, conversationId: string, apply = true) => prisma.$transaction(
  tx => linkUazapiConversationInTransaction(tx, orgId, conversationId, apply), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
);
