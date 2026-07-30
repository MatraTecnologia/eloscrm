import { ClientSource } from "../../generated/prisma/client.js";
import * as repo from "./dashboard.repo.js";

export const getStats = async (orgId: string) => {
  const [totalClients, totalDeals, stageAggregates, stages, sourceCounts, nurturing, nurtureDue] =
    await Promise.all([
      repo.countClients(orgId),
      repo.countDeals(orgId),
      repo.dealStageAggregates(orgId),
      repo.orgStagesWithPipeline(orgId),
      repo.clientSourceCounts(orgId),
      repo.countNurturing(orgId),
      repo.countNurtureDue(orgId),
    ]);

  const dealsByStage = new Map(stageAggregates.map((row) => [row.stageId, row]));

  let wonDeals = 0;
  let openDeals = 0;
  let openValue = 0;
  for (const stage of stages) {
    const agg = dealsByStage.get(stage.id);
    if (!agg) continue;
    if (stage.isWon) {
      wonDeals += agg._count._all;
    } else if (!stage.isLost) {
      openDeals += agg._count._all;
      openValue += Number(agg._sum.value ?? 0);
    }
  }

  // funil = só os estágios do pipeline default da org, já que estágios agora são dinâmicos
  // e não dá pra agregar funil comparável entre pipelines diferentes
  const funnel = stages
    .filter((stage) => stage.pipeline.isDefault)
    .sort((a, b) => a.position - b.position)
    .map((stage) => ({ name: stage.name, total: dealsByStage.get(stage.id)?._count._all ?? 0 }));

  const bySource = Object.fromEntries(Object.values(ClientSource).map((source) => [source, 0])) as Record<
    ClientSource,
    number
  >;
  for (const row of sourceCounts) bySource[row.source] = row._count._all;

  return {
    kpis: { totalClients, totalDeals, openDeals, wonDeals, openValue, nurturing, nurtureDue },
    funnel,
    bySource,
  };
};
