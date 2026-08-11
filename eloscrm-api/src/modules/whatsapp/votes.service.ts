import { WhatsappDirection } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ParsedMessage } from "./message-envelope.js";

/** Um voto guardado na enquete. `voter` é o LID de quem votou — `me` quando saiu daqui. */
export type PollVote = {
  voter: string;
  voterName: string | null;
  /** uma opção na enquete de escolha única; todas as marcadas na de múltipla */
  choices: string[];
  votedAt: string;
};

/**
 * Normaliza a enquete na saída da API.
 *
 * O voto já foi gravado com `choice` (uma opção) antes de o tráfego mostrar que múltipla escolha
 * manda todas juntas. Esses registros existem em produção — o deploy saiu entre uma coisa e outra —,
 * e sem tradução o front quebrava com `choices` indefinido ao abrir a conversa.
 *
 * Converter na leitura, e não por backfill, resolve o histórico e o que estiver em voo de uma vez:
 * a próxima gravação já sai no formato novo.
 */
export const normalizePoll = <T>(poll: T): T => {
  if (!poll || typeof poll !== "object") return poll;

  const atual = poll as { votes?: { choices?: string[]; choice?: string }[] };
  if (!Array.isArray(atual.votes)) return poll;

  return {
    ...atual,
    votes: atual.votes.map((voto) => ({
      ...voto,
      choices: voto.choices ?? (voto.choice ? [voto.choice] : []),
    })),
  } as T;
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
 * Separa as opções votadas.
 *
 * O provedor junta tudo com vírgula, e nome de opção também pode ter vírgula — então a lista da
 * própria enquete é que desempata: primeiro tenta o texto inteiro como uma opção só (o caso de
 * `"Sim, quero"` votado sozinho), depois divide e fica com os pedaços que são opções conhecidas.
 * Se nada casar, guarda como veio: um voto estranho registrado é melhor que um voto perdido.
 *
 * O limite conhecido é a combinação das duas coisas — duas opções marcadas, uma delas com vírgula no
 * nome. Aí não há como separar sem ambiguidade, e nenhum formato do provedor resolve isso.
 */
const resolveChoices = (texto: string, options: string[]): string[] => {
  if (options.includes(texto)) return [texto];

  const partes = texto
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean);
  const conhecidas = partes.filter((parte) => options.includes(parte));

  return conhecidas.length > 0 ? conhecidas : partes;
};

/**
 * Aplica o voto que chegou pelo webhook.
 *
 * **Voto não é mensagem.** O WhatsApp mostra o resultado dentro da própria enquete, e ingerir o
 * `PollUpdateMessage` como linha da conversa produzia uma bolha órfã por voto — que, sem texto nem
 * mídia, ainda caía no cartão genérico de arquivo. É o mesmo tratamento que a reação já recebia.
 *
 * O voto substitui o anterior **da mesma pessoa**: cada mudança emite outro `PollUpdateMessage` com
 * o estado completo — em enquete de múltipla escolha, marcar a segunda opção manda
 * `"Opção 1, Opção 2"`, não só a nova (confirmado no tráfego de 2026-08-10). Substituir é, portanto,
 * o comportamento certo; acumular duplicaria a primeira.
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
  const semVoto = (poll.votes ?? []).filter((voto) => voto.voter !== voter);

  // Desmarcar tudo chega como `vote: ""` — o voto sai da enquete, exatamente como a reação some
  // quando a pessoa desfaz o emoji.
  const choices = parsed.vote.choicesText
    ? resolveChoices(parsed.vote.choicesText, poll.options ?? [])
    : [];

  const votes: PollVote[] =
    choices.length > 0
      ? [
          ...semVoto,
          {
            voter,
            voterName: parsed.senderName,
            choices,
            votedAt: parsed.sentAt.toISOString(),
          },
        ]
      : semVoto;

  await prisma.whatsappMessage.update({
    where: { id: enquete.id },
    data: { poll: { ...poll, votes } },
  });

  return { pollId: enquete.id, votes: votes.length };
};
