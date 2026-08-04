import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Negócios abertos por corretor — o critério da roleta, e o número que a tela mostra.
 *
 * "Aberto" é estágio que não é ganho nem perdido: negócio encerrado não ocupa a agenda de ninguém,
 * e contá-lo faria a distribuição punir justamente quem vende.
 */
export const openDealsByOwner = async (orgId: string, db: Db = prisma) => {
  const rows = await db.deal.groupBy({
    by: ["ownerId"],
    where: { organizationId: orgId, stage: { isWon: false, isLost: false } },
    _count: { _all: true },
  });
  return new Map(
    rows.flatMap((row) => (row.ownerId ? [[row.ownerId, row._count._all] as const] : [])),
  );
};

type Candidato = { userId: string; carga: number; lastAssignedAt: Date | null };

/**
 * A ordem da roleta.
 *
 * Menos carga primeiro. O empate **não é exceção, é o estado inicial**: numa imobiliária que acabou
 * de ligar a chave todos têm zero, e sem desempate estável o primeiro da lista receberia todos os
 * leads até alguém acumular carga — a roleta pareceria quebrada justamente na estreia.
 *
 * Desempata quem recebeu há mais tempo (nulo primeiro, para quem nunca recebeu entrar na frente).
 * Isso faz a roleta se comportar como rodízio enquanto as cargas são iguais, e como balanceamento
 * quando deixam de ser. O `userId` no fim existe só para a ordem ser determinística.
 */
const daVez = (a: Candidato, b: Candidato) => {
  if (a.carga !== b.carga) return a.carga - b.carga;
  const ta = a.lastAssignedAt?.getTime() ?? 0;
  const tb = b.lastAssignedAt?.getTime() ?? 0;
  if (ta !== tb) return ta - tb;
  return a.userId < b.userId ? -1 : 1;
};

/**
 * Escolhe o corretor da vez e marca a rodada, tudo na mesma transação.
 *
 * O `FOR UPDATE` na linha de configuração serializa as atribuições **por imobiliária**. Sem ele,
 * duas mensagens no mesmo segundo leem a mesma carga e escolhem o mesmo corretor — ler-decidir-
 * gravar perde a corrida em silêncio, e o sintoma é a distribuição desigual que a roleta existe
 * para evitar. Volume de lead é baixo por natureza, então serializar sai barato e dispensa retry.
 *
 * Devolve `null` quando a chave está desligada ou não sobrou ninguém elegível — nesse caso o lead é
 * criado sem dono, que é melhor que não criar: sem responsável ele aparece na tela e alguém pega.
 */
export const pickOwner = async (orgId: string): Promise<string | null> =>
  prisma.$transaction(async (tx) => {
    const travadas = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "LeadAutomation" WHERE "organizationId" = ${orgId} FOR UPDATE
    `;
    const automationId = travadas[0]?.id;
    if (!automationId) return null;

    const automation = await tx.leadAutomation.findUnique({
      where: { id: automationId },
      select: { autoAssign: true, members: { where: { active: true } } },
    });
    if (!automation?.autoAssign || automation.members.length === 0) return null;

    // a elegibilidade real é a interseção com `Member`: `ownerId` não tem chave estrangeira, e
    // corretor que saiu da imobiliária precisa parar de receber sem ninguém limpar a configuração
    const membros = await tx.member.findMany({
      where: {
        organizationId: orgId,
        userId: { in: automation.members.map((m) => m.userId) },
      },
      select: { userId: true },
    });
    if (membros.length === 0) return null;

    const naOrg = new Set(membros.map((m) => m.userId));
    const carga = await openDealsByOwner(orgId, tx);

    const candidatos = automation.members
      .filter((m) => naOrg.has(m.userId))
      .map((m) => ({
        userId: m.userId,
        carga: carga.get(m.userId) ?? 0,
        lastAssignedAt: m.lastAssignedAt,
      }));

    const escolhido = candidatos.sort(daVez)[0]!;

    // marcar dentro da mesma transação é o que faz a próxima chamada ver esta rodada
    await tx.leadAutomationMember.update({
      where: { automationId_userId: { automationId, userId: escolhido.userId } },
      data: { lastAssignedAt: new Date() },
    });

    return escolhido.userId;
  });

/**
 * Quem fica com o que a automação criou.
 *
 * Lead que **já tem** dono nunca passa pela roleta: o negócio novo herda o dono dele. Quem atende
 * aquele cliente é quem deve ver o card, e sortear ali seria a automação desfazendo combinação
 * feita fora do sistema. Lead órfão, esse sim, entra na roleta — não há trabalho a desfazer, e é
 * justamente o lead que ninguém está olhando.
 */
export const resolveOwner = async (orgId: string, currentOwnerId: string | null) =>
  currentOwnerId ?? (await pickOwner(orgId));
