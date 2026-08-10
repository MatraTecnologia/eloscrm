import type { Actor } from "../../lib/actor.js";
import { autoDealTitle } from "../../lib/deal-title.js";
import { notFound } from "../../lib/http-error.js";
import { isAutoNamed, suggestedNameOf } from "../../lib/lead-name.js";
import { prisma } from "../../lib/prisma.js";
import * as clients from "./clients.service.js";

/** De onde veio o nome sugerido — a tela mostra, porque um vale mais que o outro. */
export type NameFixSource = "CONTACT" | "PROFILE";

export type NameFix = {
  clientId: string;
  currentName: string;
  phone: string | null;
  suggestion: string | null;
  source: NameFixSource | null;
  /** cards que serão renomeados junto, por ainda repetirem o nome automático */
  deals: number;
  lastMessageAt: Date | null;
};

/**
 * Os leads que ficaram chamados pelo próprio telefone.
 *
 * Devolve **todos**, não só os que têm sugestão: metade dos casos observados em produção é de
 * conversa com uma ou duas mensagens em que ninguém respondeu, e para essas não existe nome em lugar
 * nenhum — a tela ainda precisa listá-las para alguém digitar o nome à mão. Quem tem sugestão vem
 * primeiro, e o resto por conversa mais recente: é a ordem em que compensa trabalhar.
 */
export const listAutoNamed = async (orgId: string): Promise<NameFix[]> => {
  const candidatos = (
    await prisma.client.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, phone: true },
    })
  ).filter(isAutoNamed);

  if (candidatos.length === 0) return [];
  const ids = candidatos.map((client) => client.id);

  // Grupo fora: o `wa_name` de um grupo é o nome do grupo, e sugeri-lo como nome de pessoa é o mesmo
  // erro que a ingestão parou de cometer.
  const conversas = await prisma.conversation.findMany({
    where: { organizationId: orgId, isGroup: false, clientId: { in: ids } },
    select: { clientId: true, contactName: true, waName: true, lastMessageAt: true },
    orderBy: { lastMessageAt: "desc" },
  });

  // uma consulta para todos: o funil de uma imobiliária tem milhares de cards, e uma por lead
  // transformaria a abertura da tela numa rajada de queries
  const deals = await prisma.deal.findMany({
    where: { organizationId: orgId, clientId: { in: ids } },
    select: { clientId: true, title: true },
  });

  const items = candidatos.map((client) => {
    // conversas já vêm da mais recente para a mais antiga: a primeira com nome é a melhor informada
    const comNome = conversas.find(
      (conversa) => conversa.clientId === client.id && suggestedNameOf(conversa),
    );
    const recente = conversas.find((conversa) => conversa.clientId === client.id);
    const suggestion = comNome ? suggestedNameOf(comNome) : null;

    return {
      clientId: client.id,
      currentName: client.name,
      phone: client.phone,
      suggestion,
      source: comNome ? ((comNome.contactName ? "CONTACT" : "PROFILE") as NameFixSource) : null,
      deals: deals.filter(
        (deal) => deal.clientId === client.id && deal.title === autoDealTitle(client.name),
      ).length,
      lastMessageAt: recente?.lastMessageAt ?? null,
    };
  });

  return items.sort((a, b) => {
    if (!!a.suggestion !== !!b.suggestion) return a.suggestion ? -1 : 1;
    return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
  });
};

export type NameFixInput = { clientId: string; name: string };
export type NameFixResult = {
  clientId: string;
  status: "applied" | "skipped";
  name: string;
  reason?: string;
};

/**
 * Aplica as correções, uma a uma.
 *
 * Passa por `clients.update` de propósito, em vez de um `updateMany`: é ele que grava o evento de
 * auditoria com quem clicou (`actorOf(request)`, não a automação) e que leva o nome novo para os
 * cards de título automático. Um `updateMany` seria uma linha mais curta e deixaria o funil com o
 * nome velho — exatamente o problema que a tela existe para resolver.
 *
 * A checagem de dono vem antes de qualquer escrita: com id de outra imobiliária no meio da lista, um
 * laço ingênuo aplicaria metade e só então estouraria.
 */
export const applyFixes = async (
  orgId: string,
  items: NameFixInput[],
  actor: Actor,
): Promise<{ applied: number; results: NameFixResult[] }> => {
  const encontrados = await prisma.client.findMany({
    where: { organizationId: orgId, id: { in: items.map((item) => item.clientId) } },
    select: { id: true, name: true },
  });
  const porId = new Map(encontrados.map((client) => [client.id, client]));

  const ausente = items.find((item) => !porId.has(item.clientId));
  if (ausente) throw notFound("Cliente não encontrado");

  const results: NameFixResult[] = [];
  for (const item of items) {
    const name = item.name.trim();
    const atual = porId.get(item.clientId)!;

    // A ingestão pode ter corrigido o mesmo lead entre a abertura da tela e o clique — quem
    // respondeu no WhatsApp nesse intervalo já chegou com nome. Não é erro, e o retorno diz isso.
    if (!name || name === atual.name) {
      results.push({
        clientId: item.clientId,
        status: "skipped",
        name: atual.name,
        reason: name ? "já estava com esse nome" : "nome vazio",
      });
      continue;
    }

    await clients.update(orgId, item.clientId, { name }, actor);
    results.push({ clientId: item.clientId, status: "applied", name });
  }

  return { applied: results.filter((result) => result.status === "applied").length, results };
};
