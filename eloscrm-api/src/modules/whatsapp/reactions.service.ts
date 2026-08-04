import { UazapiInstanceStatus, WhatsappDirection } from "../../generated/prisma/client.js";
import { conflict, notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { instanceClient, requireIntegration, uazapiError } from "./whatsapp.gateway.js";
import type { ParsedMessage } from "./message-envelope.js";

/**
 * Quem reagiu, na forma que o `@@unique` espera.
 *
 * O que sai daqui colapsa em `me` mesmo quando volta pelo webhook com o LID da própria instância —
 * senão a reação feita pelo celular e a feita pelo CRM viram duas linhas da mesma pessoa.
 */
const authorOf = (fromMe: boolean, senderLid: string | null) =>
  fromMe ? "me" : (senderLid ?? "them");

/**
 * Aplica a reação que chegou pelo webhook.
 *
 * `message.reaction` traz o `messageid` puro do alvo, e `text` o emoji — vazio quando a pessoa
 * desfez. A reação **não** vira mensagem na thread: o WhatsApp a mostra colada na bolha do alvo, e
 * ingerir como mensagem encheria a conversa de bolhas soltas de emoji.
 *
 * Alvo fora da nossa base (mensagem anterior à integração) é ignorado em silêncio: não há bolha
 * onde pendurar o emoji, e recusar o evento só encheria `/webhook/errors`.
 */
export const applyReaction = async (
  orgId: string,
  conversationId: string,
  parsed: ParsedMessage,
) => {
  if (!parsed.reactionTo) return { skipped: "sem alvo" as const };

  const alvo = await prisma.whatsappMessage.findFirst({
    where: { organizationId: orgId, conversationId, providerMessageId: parsed.reactionTo },
    select: { id: true },
  });
  if (!alvo) return { skipped: "alvo desconhecido" as const };

  const fromMe = parsed.direction === WhatsappDirection.outbound;
  const authorLid = authorOf(fromMe, parsed.senderLid);
  const emoji = parsed.text?.trim() ?? "";

  if (!emoji) {
    await prisma.whatsappReaction.deleteMany({ where: { messageId: alvo.id, authorLid } });
    return { removed: true as const };
  }

  await prisma.whatsappReaction.upsert({
    where: { messageId_authorLid: { messageId: alvo.id, authorLid } },
    create: {
      messageId: alvo.id,
      emoji,
      authorLid,
      authorName: parsed.senderName,
      reactedAt: parsed.sentAt,
    },
    // trocar de emoji substitui: o provedor garante uma reação ativa por pessoa e por mensagem
    update: { emoji, authorName: parsed.senderName, reactedAt: parsed.sentAt },
  });

  return { emoji };
};

/**
 * Reage a uma mensagem pelo CRM.
 *
 * `emoji` vazio remove, que é como a uazapi modela o "desreagir" (`/message/react` com `text: ""`).
 *
 * **Vale para mensagem própria também.** A spec do provedor diz que "só é possível reagir a
 * mensagens enviadas por outros usuários", mas o WhatsApp aceita — verificado no aparelho em
 * 2026-08-04. A frase da spec descreve uma limitação que não se confirma; se `/message/react`
 * recusar em algum caso, o erro do provedor sobe traduzido pelo `uazapiError`.
 */
export const react = async (
  orgId: string,
  conversationId: string,
  messageId: string,
  emoji: string,
) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: orgId },
    include: { instance: true },
  });
  if (!conversation) throw notFound("Conversa não encontrada");
  if (conversation.instance.status !== UazapiInstanceStatus.connected) {
    throw conflict("INSTANCE_NOT_CONNECTED", "Conecte o WhatsApp antes de reagir");
  }

  const alvo = await prisma.whatsappMessage.findFirst({
    where: { id: messageId, conversationId },
    select: { id: true, providerMessageId: true, direction: true },
  });
  if (!alvo) throw notFound("Mensagem não encontrada");
  if (!alvo.providerMessageId) {
    throw conflict("MESSAGE_NOT_REACTABLE", "Esta mensagem ainda não pode receber reação");
  }
  const config = requireIntegration();
  const destino = conversation.isGroup
    ? conversation.chatid
    : (conversation.phone ?? conversation.chatid);

  const result = await instanceClient(config, conversation.instance.tokenEnc).messages.react({
    number: destino,
    text: emoji,
    id: alvo.providerMessageId,
  });
  if (!result.success) throw uazapiError(result.error);

  // grava só depois do provedor aceitar: reação que aparece e some é pior que meio segundo de espera
  if (!emoji) {
    await prisma.whatsappReaction.deleteMany({ where: { messageId: alvo.id, authorLid: "me" } });
    return { emoji: null };
  }

  await prisma.whatsappReaction.upsert({
    where: { messageId_authorLid: { messageId: alvo.id, authorLid: "me" } },
    create: { messageId: alvo.id, emoji, authorLid: "me", reactedAt: new Date() },
    update: { emoji, reactedAt: new Date() },
  });
  return { emoji };
};
