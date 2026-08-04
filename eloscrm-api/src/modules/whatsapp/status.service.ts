import {
  WhatsappDirection,
  WhatsappMessageStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Aplica os recibos de entrega/leitura que chegam em `messages_update`.
 *
 * O evento é **em lote**: um único `ReadReceipt` observado carregava 12 ids. E chega fora de ordem —
 * daí a regra de nunca regredir o status (§2.6 do spec).
 */

const RANK: Record<WhatsappMessageStatus, number> = {
  [WhatsappMessageStatus.failed]: 0,
  [WhatsappMessageStatus.pending]: 1,
  [WhatsappMessageStatus.sent]: 2,
  [WhatsappMessageStatus.delivered]: 3,
  [WhatsappMessageStatus.read]: 4,
};

const STATE_TO_STATUS: Record<string, WhatsappMessageStatus> = {
  delivered: WhatsappMessageStatus.delivered,
  read: WhatsappMessageStatus.read,
  played: WhatsappMessageStatus.read,
};

export type ParsedStatusUpdate = {
  status: WhatsappMessageStatus;
  providerMessageIds: string[];
};

/** `event` aqui é OBJETO (payload), não o nome do evento — foi o que derrubou a API com 422. */
const payloadOf = (body: Record<string, unknown>) => {
  const event = body.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return event as Record<string, unknown>;
};

const stateOf = (body: Record<string, unknown>, data: Record<string, unknown>) =>
  (
    (typeof body.state === "string" ? body.state : null) ??
    (typeof data.Type === "string" ? data.Type : null) ??
    ""
  ).toLowerCase();

const messageIdsOf = (data: Record<string, unknown>) =>
  Array.isArray(data.MessageIDs)
    ? data.MessageIDs.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

export const parseStatusUpdate = (body: Record<string, unknown>): ParsedStatusUpdate | null => {
  const data = payloadOf(body);
  if (!data) return null;

  const status = STATE_TO_STATUS[stateOf(body, data)];
  if (!status) return null;

  const ids = messageIdsOf(data);
  if (ids.length === 0) return null;

  return { status, providerMessageIds: ids };
};

/**
 * "Apagar para todos" chega no MESMO `messages_update` dos recibos, com `state: "Deleted"`
 * (`type: "DeletedMessage"`, `event.Type: "Deleted"`) e os ids no `MessageIDs`. Observado em
 * tráfego real em 2026-08-04 — a spec da uazapi não documenta.
 *
 * Antes disso, `parseStatusUpdate` devolvia null aqui e a rota respondia `handled: true`: o evento
 * era reconhecido e descartado calado, e o CRM seguia exibindo o que o lead tinha apagado.
 */
export const parseDeletion = (body: Record<string, unknown>): string[] | null => {
  const data = payloadOf(body);
  if (!data) return null;
  if (stateOf(body, data) !== "deleted") return null;

  const ids = messageIdsOf(data);
  return ids.length > 0 ? ids : null;
};

/**
 * `IsFromMe` e `Timestamp` do payload não entram na decisão de propósito. `IsFromMe` chega como a
 * **string** `"False"` e sua semântica exata (quem emitiu o recibo) não foi confirmada em tráfego;
 * `Timestamp` vem em **segundos**, ao contrário do `messageTimestamp` de `messages`. Os
 * `MessageIDs` já dizem exatamente quais mensagens mudaram — não é preciso inferir nada.
 */
export const applyStatusUpdate = async (orgId: string, parsed: ParsedStatusUpdate) => {
  const alvo = RANK[parsed.status];
  // só sobe: recibo atrasado de "entregue" não pode desfazer um "lido" já registrado
  const regrediria = Object.entries(RANK)
    .filter(([, rank]) => rank >= alvo)
    .map(([status]) => status as WhatsappMessageStatus);

  const afetadas = await prisma.whatsappMessage.findMany({
    where: {
      organizationId: orgId,
      providerMessageId: { in: parsed.providerMessageIds },
      status: { notIn: regrediria },
    },
    select: { id: true, conversationId: true, direction: true },
  });
  if (afetadas.length === 0) return { updated: 0 };

  await prisma.whatsappMessage.updateMany({
    where: { id: { in: afetadas.map((m) => m.id) } },
    data: { status: parsed.status },
  });

  // O corretor leu no celular: manter o contador aceso no CRM faria a conversa parecer pendente
  // para sempre. Só recibo de leitura zera — "entregue" não significa que alguém viu.
  if (parsed.status === WhatsappMessageStatus.read) {
    const conversas = [
      ...new Set(
        afetadas
          .filter((m) => m.direction === WhatsappDirection.inbound)
          .map((m) => m.conversationId),
      ),
    ];
    if (conversas.length > 0) {
      await prisma.conversation.updateMany({
        where: { id: { in: conversas } },
        data: { unreadCount: 0 },
      });
    }
  }

  return { updated: afetadas.length };
};

/**
 * Fixar/desafixar feito **fora do CRM** (pelo celular) chega no mesmo `messages_update`, com
 * `type: "PinnedMessage"` e `state: "Pinned" | "Unpinned"`. Capturado em 2026-08-04.
 *
 * Sem tratar, o evento era reconhecido e descartado calado: fixar pelo aparelho não aparecia na
 * barra do topo, e desafixar por lá deixava a barra mostrando algo que já não estava fixado.
 */
export const parsePin = (body: Record<string, unknown>): PinUpdate | null => {
  const data = payloadOf(body);
  if (!data) return null;

  const state = stateOf(body, data);
  if (state !== "pinned" && state !== "unpinned") return null;

  const ids = messageIdsOf(data);
  return ids.length > 0 ? { pin: state === "pinned", providerMessageIds: ids } : null;
};

export type PinUpdate = { pin: boolean; providerMessageIds: string[] };

/**
 * O evento **não traz a duração** do pin, só que ele existe.
 *
 * Trinta dias é o padrão do próprio provedor quando `duration` não vem, então é o palpite menos
 * errado — e `pinnedUntil` precisa de algum valor, senão a barra do topo (que filtra por ele)
 * ignoraria todo pin feito pelo celular.
 */
const PIN_PADRAO_DIAS = 30;

export const applyPin = async (orgId: string, parsed: PinUpdate) => {
  const afetadas = await prisma.whatsappMessage.findMany({
    where: { organizationId: orgId, providerMessageId: { in: parsed.providerMessageIds } },
    select: { id: true },
  });
  if (afetadas.length === 0) return { pinned: 0 };

  const agora = new Date();
  await prisma.whatsappMessage.updateMany({
    where: { id: { in: afetadas.map((m) => m.id) } },
    data: parsed.pin
      ? {
          pinnedAt: agora,
          pinnedUntil: new Date(agora.getTime() + PIN_PADRAO_DIAS * 24 * 60 * 60 * 1000),
        }
      : { pinnedAt: null, pinnedUntil: null },
  });

  return { pinned: afetadas.length };
};

/**
 * Marca as mensagens como apagadas e conserta o que a conversa guardava sobre elas.
 *
 * Dois estados derivados dependem do conteúdo e ficariam mentindo:
 *
 * - `lastMessageText` guarda uma **cópia** do texto, então a lista de conversas continuaria
 *   mostrando o que a thread já não mostra. É recalculado lendo a última mensagem de novo — a
 *   prévia não guarda de qual mensagem veio, então comparar strings seria adivinhação.
 * - `unreadCount` contaria uma mensagem que não existe mais para o corretor: a conversa apareceria
 *   como pendente e abrir não revelaria nada. O piso em zero é proteção contra descontar algo já
 *   lido — o contador é um número, não uma marca por mensagem, então essa correção é aproximada
 *   por natureza; errar para baixo é melhor que deixar a conversa acesa para sempre.
 */
export const applyDeletion = async (orgId: string, providerMessageIds: string[]) => {
  const afetadas = await prisma.whatsappMessage.findMany({
    where: {
      organizationId: orgId,
      providerMessageId: { in: providerMessageIds },
      deletedAt: null,
    },
    select: { id: true, conversationId: true, direction: true },
  });
  if (afetadas.length === 0) return { deleted: 0 };

  await prisma.whatsappMessage.updateMany({
    where: { id: { in: afetadas.map((m) => m.id) } },
    data: { deletedAt: new Date() },
  });

  for (const conversationId of new Set(afetadas.map((m) => m.conversationId))) {
    const [conversa, ultima] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { unreadCount: true },
      }),
      prisma.whatsappMessage.findFirst({
        where: { conversationId },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true, text: true, deletedAt: true },
      }),
    ]);
    if (!conversa || !ultima) continue;

    // só o que o lead mandou entrou no contador; o que sai daqui nunca entrou
    const recebidasApagadas = afetadas.filter(
      (m) => m.conversationId === conversationId && m.direction === WhatsappDirection.inbound,
    ).length;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: ultima.sentAt,
        // apagada não devolve texto nem para a prévia: é o mesmo conteúdo que a thread esconde
        lastMessageText: ultima.deletedAt ? null : ultima.text,
        unreadCount: Math.max(0, conversa.unreadCount - recebidasApagadas),
      },
    });
  }

  return { deleted: afetadas.length };
};
