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

export const parseStatusUpdate = (body: Record<string, unknown>): ParsedStatusUpdate | null => {
  // `event` aqui é OBJETO (payload), não o nome do evento — foi o que derrubou a API com 422
  const event = body.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const data = event as Record<string, unknown>;

  const rawState =
    (typeof body.state === "string" ? body.state : null) ??
    (typeof data.Type === "string" ? data.Type : null);
  const status = STATE_TO_STATUS[(rawState ?? "").toLowerCase()];
  if (!status) return null;

  const ids = Array.isArray(data.MessageIDs)
    ? data.MessageIDs.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) return null;

  return { status, providerMessageIds: ids };
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
