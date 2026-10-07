import { prisma } from "../../lib/prisma.js";
import { conflict, notFound } from "../../lib/http-error.js";

// Compara o DDI inteiro. A única equivalência adicional é o nono dígito de celulares brasileiros.
export const sameSenderNumber = (official: string | null, ownerJid: string | null) => {
  const left = official?.replace(/[+\s().-]/g, "");
  const right = ownerJid?.match(/^(\d{10,15})@s\.whatsapp\.net$/)?.[1];
  if (!left || !right || !/^\d{10,15}$/.test(left)) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return /^55\d{2}[6-9]\d{7}$/.test(shorter) && longer === `${shorter.slice(0, 4)}9${shorter.slice(4)}`;
};

export const legacyEligibility = async (orgId: string, instanceId: string) => {
  const [instance, connections] = await Promise.all([
    prisma.uazapiInstance.findFirst({ where: { organizationId: orgId, id: instanceId, status: "connected", remoteDeletedAt: null }, select: { ownerJid: true } }),
    prisma.channelConnection.findMany({ where: { organizationId: orgId, provider: "cloud_api", status: "connected", isOnBusinessApp: true, disabledAt: null, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }] }, select: { displayPhoneNumber: true } }),
  ]);
  return !!instance && connections.some(connection => sameSenderNumber(connection.displayPhoneNumber, instance.ownerJid));
};

export const requireLegacyEligibility = async (orgId: string, conversationId: string) => {
  const conversation = await prisma.conversation.findFirst({ where: { organizationId: orgId, id: conversationId }, select: { instanceId: true, instance: { select: { status: true, remoteDeletedAt: true } } } });
  if (!conversation) throw notFound("Conversa não encontrada nesta imobiliária");
  if (conversation.instance?.remoteDeletedAt) throw conflict("INSTANCE_REMOTE_DELETED", "A conexão de WhatsApp não existe mais no servidor");
  if (conversation.instance && conversation.instance.status !== "connected") throw conflict("INSTANCE_NOT_CONNECTED", "Conecte o WhatsApp antes de enviar mensagens");
  if (!conversation.instanceId || !await legacyEligibility(orgId, conversation.instanceId)) throw conflict("UAZAPI_NUMBER_MISMATCH", "Na conversa, a uazapi deve usar o mesmo número do WhatsApp oficial conectado em Coexistence. Use Disparos para números separados.");
};

export const resolveManualRoute = async (orgId: string, conversationId: string) => {
  const conversation = await prisma.conversation.findFirst({ where: { organizationId: orgId, id: conversationId, isGroup: false, connection: { provider: "cloud_api" } }, include: { connection: true, messagingContact: { select: { clientId: true } } } });
  if (!conversation?.connection || !conversation.messagingContactId) throw notFound("Conversa oficial não encontrada nesta imobiliária");
  const connection = conversation.connection;
  const instance = await prisma.uazapiInstance.findFirst({ where: { organizationId: orgId, status: "connected", remoteDeletedAt: null } });
  if (connection.status !== "connected" || connection.disabledAt || !connection.isOnBusinessApp || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) throw conflict("UAZAPI_OFFICIAL_UNAVAILABLE", "O número oficial precisa estar conectado em Coexistence para usar a uazapi na conversa");
  if (!instance || !sameSenderNumber(connection.displayPhoneNumber, instance.ownerJid)) throw conflict("UAZAPI_NUMBER_MISMATCH", "A uazapi usa outro número ou está desconectada. Números separados estão disponíveis apenas em Disparos.");
  const identities = await prisma.contactIdentity.findMany({ where: { organizationId: orgId, contactId: conversation.messagingContactId, scope: `business:${connection.businessPortfolioId}`, source: "provider", validUntil: null, validFrom: { lte: new Date() }, kind: { in: ["wa_id", "phone"] } }, select: { kind: true, value: true } });
  const identity = identities.find(item => item.kind === "wa_id") ?? identities[0];
  if (!identity || !/^\d{10,15}$/.test(identity.value)) throw conflict("UAZAPI_RECIPIENT_UNAVAILABLE", "Este contato não possui um telefone vigente informado pela Meta; use o canal oficial");
  return { conversation, connection, instance, destination: identity.value };
};

export const manualEligibility = async (orgId: string, conversationId: string) => {
  try { const route = await resolveManualRoute(orgId, conversationId); return { allowed: true, reason: null, number: route.connection.displayPhoneNumber }; }
  catch (error) {
    if (error instanceof Error && "expose" in error && error.expose === true) return { allowed: false, reason: error.message, number: null };
    throw error;
  }
};
