import { WhatsappDirection } from "../../generated/prisma/client.js";
import { createWorker, enqueue } from "../../lib/queue.js";
import { findClientsByPhoneKey } from "../clients/clients.repo.js";
import * as repo from "./conversations.repo.js";
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
 */
const linkClientIfUnambiguous = async (
  orgId: string,
  conversationId: string,
  phoneKey: string | null,
  alreadyLinked: boolean,
) => {
  if (alreadyLinked || !phoneKey) return;
  const candidates = await findClientsByPhoneKey(orgId, phoneKey);
  if (candidates.length !== 1) return;
  await repo.linkClient(conversationId, candidates[0]!.id);
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

  await linkClientIfUnambiguous(
    job.organizationId,
    conversation.id,
    parsedChat.phoneKey,
    Boolean(conversation.clientId),
  );

  return { messageId: message.id, conversationId: conversation.id };
};

createWorker<MessageJob>(MESSAGE_QUEUE, async (job) => processMessageEvent(job.data));

export const enqueueMessageEvent = (job: MessageJob) => enqueue(MESSAGE_QUEUE, job);
