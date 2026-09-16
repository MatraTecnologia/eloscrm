import { WhatsappDirection } from "../../generated/prisma/client.js";
import { phoneKey } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
import type { BroadcastFilters } from "./broadcasts.schema.js";
import type { MatchedDeal } from "./broadcasts.repo.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Condição "retorno do lead", decidida pela última mensagem da conversa dele no WhatsApp.
 *
 * Não cabe no `where` do Prisma: "a última mensagem é nossa" é uma comparação entre linhas da mesma
 * conversa. Então roda depois do filtro de banco, sobre o que sobrou. A conversa é achada pelo
 * vínculo explícito (`clientId`) ou pela `phoneKey` do telefone do lead — o mesmo casamento que a
 * caixa de entrada faz —, e quem nunca conversou fica de fora nos dois modos: "não respondeu"
 * pressupõe que alguém escreveu antes.
 */
export const applyReplyFilter = async (
  orgId: string,
  deals: MatchedDeal[],
  filters: BroadcastFilters,
) => {
  if (!filters.reply || deals.length === 0) return deals;

  const clientIds = deals.map((d) => d.client.id);
  const keys = deals.flatMap((d) => {
    const key = phoneKey(d.client.phone);
    return key ? [key] : [];
  });
  const conversations = await prisma.conversation.findMany({
    where: {
      organizationId: orgId,
      isGroup: false,
      OR: [{ clientId: { in: clientIds } }, ...(keys.length ? [{ phoneKey: { in: keys } }] : [])],
    },
    select: {
      clientId: true,
      phoneKey: true,
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { direction: true, sentAt: true },
      },
    },
  });

  // última mensagem por lead, olhando todas as conversas que apontam para ele (vínculo ou telefone)
  type Last = { direction: WhatsappDirection; sentAt: Date };
  const lastByClient = new Map<string, Last>();
  const lastByKey = new Map<string, Last>();
  const keep = (map: Map<string, Last>, id: string, last: Last) => {
    const atual = map.get(id);
    if (!atual || last.sentAt > atual.sentAt) map.set(id, last);
  };
  for (const conversation of conversations) {
    const last = conversation.messages[0];
    if (!last) continue;
    if (conversation.clientId) keep(lastByClient, conversation.clientId, last);
    if (conversation.phoneKey) keep(lastByKey, conversation.phoneKey, last);
  }

  const limite = filters.noReplyDays ? Date.now() - filters.noReplyDays * DAY_MS : null;

  return deals.filter((deal) => {
    const key = phoneKey(deal.client.phone);
    const candidatos = [lastByClient.get(deal.client.id), key ? lastByKey.get(key) : undefined];
    const last = candidatos
      .filter((c): c is Last => !!c)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    if (!last) return false;
    if (filters.reply === "REPLIED") return last.direction === WhatsappDirection.inbound;
    // sem retorno: a última é nossa — e, se pediram um prazo, já faz tanto tempo que foi mandada
    return (
      last.direction === WhatsappDirection.outbound &&
      (limite === null || last.sentAt.getTime() <= limite)
    );
  });
};
