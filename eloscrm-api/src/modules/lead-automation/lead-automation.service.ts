import type { Actor } from "../../lib/actor.js";
import { forbidden, httpError, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import { prisma } from "../../lib/prisma.js";
import * as repo from "./lead-automation.repo.js";
import type { UpdateLeadAutomationInput } from "./lead-automation.schema.js";

const invalid = (code: string, message: string) => httpError(422, code, message);

const requireManager = async (orgId: string, actor: Actor) => {
  if (!(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só o dono ou um gestor da imobiliária pode configurar a automação de leads");
  }
};

/**
 * Negócios abertos por corretor — o critério da roleta, e o número que a tela mostra ao lado de cada
 * um. "Aberto" é estágio que não é ganho nem perdido: negócio encerrado não ocupa a agenda de
 * ninguém, e contá-lo faria a distribuição punir quem vende.
 */
export const openDealsByOwner = async (orgId: string) => {
  const rows = await prisma.deal.groupBy({
    by: ["ownerId"],
    where: { organizationId: orgId, stage: { isWon: false, isLost: false } },
    _count: { _all: true },
  });
  return new Map(
    rows.flatMap((row) => (row.ownerId ? [[row.ownerId, row._count._all] as const] : [])),
  );
};

/**
 * Membros da organização com o estado da roleta.
 *
 * A lista sai de `Member`, não da tabela de automação: `ownerId` não tem chave estrangeira, e quem
 * saiu da imobiliária precisa sumir daqui sem ninguém lembrar de limpar a configuração.
 */
const listMembers = async (orgId: string, ativos: Set<string>) => {
  const [members, carga] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: orgId },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    openDealsByOwner(orgId),
  ]);

  return members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    active: ativos.has(member.userId),
    openDeals: carga.get(member.userId) ?? 0,
  }));
};

const serialize = async (
  orgId: string,
  automation: Awaited<ReturnType<typeof repo.findOrCreate>>,
) => {
  const ativos = new Set(automation.members.filter((m) => m.active).map((m) => m.userId));
  return {
    autoCreateClient: automation.autoCreateClient,
    autoCreateDeal: automation.autoCreateDeal,
    pipelineId: automation.pipelineId,
    stageId: automation.stageId,
    autoAssign: automation.autoAssign,
    strategy: automation.strategy,
    members: await listMembers(orgId, ativos),
  };
};

export const get = async (orgId: string) => serialize(orgId, await repo.findOrCreate(orgId));

/**
 * Valida o destino do negócio.
 *
 * Sem conferir a organização, um id chutado apontaria a automação para o funil de outra
 * imobiliária — e o negócio nasceria lá. O estágio precisa ser do funil escolhido pelo mesmo
 * motivo que o `DealForm` só oferece estágios do funil atual: par inconsistente cria card órfão.
 */
const validateTarget = async (orgId: string, data: UpdateLeadAutomationInput) => {
  if (!data.autoCreateDeal) return;
  if (!data.pipelineId || !data.stageId) {
    throw invalid(
      "AUTOMATION_TARGET_REQUIRED",
      "Escolha o funil e o estágio para criar o negócio automaticamente",
    );
  }

  const stage = await prisma.stage.findFirst({
    where: { id: data.stageId, organizationId: orgId, pipelineId: data.pipelineId },
    select: { id: true },
  });
  if (!stage) throw notFound("Estágio não encontrado neste funil");
};

const validateMembers = async (orgId: string, userIds: string[]) => {
  if (userIds.length === 0) return;
  const membros = await prisma.member.findMany({
    where: { organizationId: orgId, userId: { in: userIds } },
    select: { userId: true },
  });
  if (membros.length !== new Set(userIds).size) {
    throw invalid("MEMBER_NOT_IN_ORG", "A roleta só aceita membros desta imobiliária");
  }
};

export const update = async (orgId: string, data: UpdateLeadAutomationInput, actor: Actor) => {
  await requireManager(orgId, actor);
  await validateTarget(orgId, data);
  await validateMembers(orgId, data.memberUserIds);

  return serialize(orgId, await repo.save(orgId, data));
};
