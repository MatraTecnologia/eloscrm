import { prisma } from "../../lib/prisma.js";
import { ClientStatus } from "../../generated/prisma/client.js";

// o painel mede a base que está sendo trabalhada; o lead em nutrição tem KPI próprio
export const countClients = (orgId: string) =>
  prisma.client.count({ where: { organizationId: orgId, status: ClientStatus.ACTIVE } });

export const countNurturing = (orgId: string) =>
  prisma.client.count({ where: { organizationId: orgId, status: ClientStatus.NURTURING } });

export const countNurtureDue = (orgId: string) =>
  prisma.client.count({
    where: {
      organizationId: orgId,
      status: ClientStatus.NURTURING,
      nurtureUntil: { lte: new Date() },
    },
  });

export const countDeals = (orgId: string) => prisma.deal.count({ where: { organizationId: orgId } });

export const dealStageAggregates = (orgId: string) =>
  prisma.deal.groupBy({
    by: ["stageId"],
    where: { organizationId: orgId },
    _count: { _all: true },
    _sum: { value: true },
  });

// carrega todos os estágios da org com o flag isDefault do pipeline, pra derivar
// KPIs e o funil (default apenas) em memória, sem precisar de N queries
export const orgStagesWithPipeline = (orgId: string) =>
  prisma.stage.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      position: true,
      isWon: true,
      isLost: true,
      pipeline: { select: { isDefault: true } },
    },
  });

export const clientSourceCounts = (orgId: string) =>
  prisma.client.groupBy({
    by: ["source"],
    where: { organizationId: orgId, status: ClientStatus.ACTIVE },
    _count: { _all: true },
  });
