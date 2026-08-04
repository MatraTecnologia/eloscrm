import { WhatsappDirection } from "../../generated/prisma/client.js";
import { createWorker, enqueue } from "../../lib/queue.js";
import { findClientsByPhoneKey } from "../clients/clients.repo.js";
import { applyToConversation } from "../lead-automation/apply.service.js";
import * as repo from "./conversations.repo.js";
import { enqueueMediaJob } from "./media.service.js";
import { parseConversation, parseMessage } from "./message-envelope.js";

export const MESSAGE_QUEUE = "whatsapp-message";

export type MessageJob = {
  instanceId: string;
  organizationId: string;
  body: Record<string, unknown>;
};

/**
 * Vincula a conversa a um lead pelo telefone.
 *
 * **Não vincula quando há mais de um candidato.** A chave é DDD + últimos 8 dígitos, e fixo e
 * celular do mesmo número colidem nela — atribuir a conversa ao lead errado é pior do que deixar o
 * corretor escolher. Também não sobrescreve vínculo existente: uma vez ligado, quem desfaz é gente.
 *
 * Devolve o que decidiu porque a automação precisa saber a diferença entre "não achei ninguém" e
 * "achei demais": no primeiro caso ela cria o lead, no segundo tem de ficar quieta.
 */
const linkClientIfUnambiguous = async (
  orgId: string,
  conversationId: string,
  phoneKey: string | null,
  linkedClientId: string | null,
): Promise<{ clientId: string | null; ambiguous: boolean }> => {
  if (linkedClientId) return { clientId: linkedClientId, ambiguous: false };
  if (!phoneKey) return { clientId: null, ambiguous: false };

  const candidates = await findClientsByPhoneKey(orgId, phoneKey);
  if (candidates.length !== 1) {
    return { clientId: null, ambiguous: candidates.length > 1 };
  }

  await repo.linkClient(conversationId, candidates[0]!.id);
  return { clientId: candidates[0]!.id, ambiguous: false };
};

export const processMessageEvent = async (job: MessageJob) => {
  const parsedChat = parseConversation(job.body);
  const parsedMessage = parseMessage(job.body);
  if (!parsedChat || !parsedMessage) return { skipped: true as const };

  const conversation = await repo.upsertConversation(job.organizationId, job.instanceId, parsedChat);
  const message = await repo.createMessageIfNew(job.organizationId, conversation.id, parsedMessage);

  // reentrega: a conversa já foi atualizada por esta mensagem, e contar de novo inflaria o não lido
  if (!message) return { duplicated: true as const };

  await repo.touchConversation(conversation.id, {
    lastMessageAt: parsedMessage.sentAt,
    lastMessageText: parsedMessage.text,
    incrementUnread: parsedMessage.direction === WhatsappDirection.inbound,
  });

  const vinculo = await linkClientIfUnambiguous(
    job.organizationId,
    conversation.id,
    parsedChat.phoneKey,
    conversation.clientId,
  );

  // Criar lead, pôr no funil e escolher o dono, se a imobiliária tiver pedido. O catch segue a
  // mesma regra do enqueue de mídia: automação que falha não pode virar 5xx no webhook, senão a
  // uazapi reentrega uma mensagem já gravada — e é a mensagem que importa.
  await applyToConversation({
    orgId: job.organizationId,
    conversationId: conversation.id,
    clientId: vinculo.clientId,
    ambiguous: vinculo.ambiguous,
    suggestedName: parsedChat.suggestedName,
    phone: parsedChat.phone,
  }).catch(() => undefined);

  // fila separada: a uazapi apaga a mídia em 2 dias, então o download é urgente — mas não pode
  // atrasar nem derrubar o registro da mensagem, que já está salva.
  //
  // O catch é o que torna essa frase verdadeira **sem Redis**: ali o enqueue roda o download na
  // hora, e um erro subiria até o webhook, que devolveria 5xx e faria a uazapi reentregar uma
  // mensagem já gravada. O motivo da falha não se perde — `processMediaJob` grava na própria
  // mensagem antes de relançar.
  if (parsedMessage.hasMedia) {
    await enqueueMediaJob({ messageId: message.id }).catch(() => undefined);
  }

  return { messageId: message.id, conversationId: conversation.id };
};

createWorker<MessageJob>(MESSAGE_QUEUE, async (job) => processMessageEvent(job.data));

export const enqueueMessageEvent = (job: MessageJob) => enqueue(MESSAGE_QUEUE, job);
