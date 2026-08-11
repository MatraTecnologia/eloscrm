import { WhatsappDirection } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ParsedMessage } from "./message-envelope.js";

/** Um voto guardado na enquete. `voter` é o LID de quem votou — `me` quando saiu daqui. */
export type PollVote = {
  voter: string;
  voterName: string | null;
  choice: string;
  votedAt: string;
};

type StoredPoll = {
  name: string;
  options: string[];
  multiple: boolean;
  votes?: PollVote[];
};

/**
 * Mesma regra do autor de reação: o que sai daqui colapsa em `me`, para o voto dado pelo celular da
 * imobiliária e o dado pelo CRM não virarem duas pessoas diferentes.
 */
const voterOf = (fromMe: boolean, senderLid: string | null) =>
  fromMe ? "me" : (senderLid ?? "them");

/**
 * Aplica o voto que chegou pelo webhook.
 *
 * **Voto não é mensagem.** O WhatsApp mostra o resultado dentro da própria enquete, e ingerir o
 * `PollUpdateMessage` como linha da conversa produzia uma bolha órfã por voto — que, sem texto nem
 * mídia, ainda caía no cartão genérico de arquivo. É o mesmo tratamento que a reação já recebia.
 *
 * O voto substitui o anterior **da mesma pessoa**: trocar de opção no WhatsApp emite outro
 * `PollUpdateMessage`, e sem substituir a enquete acumularia os dois. Enquete de múltipla escolha
 * manda um evento por opção marcada e, por ora, o mesmo votante fica com a última — não observamos
 * tráfego suficiente para saber se o provedor reenvia a lista inteira a cada mudança, e inventar a
 * regra errada aqui daria uma contagem que ninguém consegue explicar.
 *
 * Enquete fora da nossa base (anterior à integração) é ignorada em silêncio, como o alvo
 * desconhecido de uma reação: não há onde pendurar o voto, e recusar só encheria `/webhook/errors`.
 */
export const applyVote = async (orgId: string, conversationId: string, parsed: ParsedMessage) => {
  if (!parsed.vote) return { skipped: "sem voto" as const };

  const enquete = await prisma.whatsappMessage.findFirst({
    where: { organizationId: orgId, conversationId, providerMessageId: parsed.vote.pollId },
    select: { id: true, poll: true },
  });
  if (!enquete?.poll) return { skipped: "enquete desconhecida" as const };

  const poll = enquete.poll as StoredPoll;
  const voter = voterOf(parsed.direction === WhatsappDirection.outbound, parsed.senderLid);

  const votes: PollVote[] = [
    ...(poll.votes ?? []).filter((voto) => voto.voter !== voter),
    {
      voter,
      voterName: parsed.senderName,
      choice: parsed.vote.choice,
      votedAt: parsed.sentAt.toISOString(),
    },
  ];

  await prisma.whatsappMessage.update({
    where: { id: enquete.id },
    data: { poll: { ...poll, votes } },
  });

  return { pollId: enquete.id, votes: votes.length };
};
