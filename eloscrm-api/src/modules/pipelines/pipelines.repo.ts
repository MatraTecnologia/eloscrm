import { prisma } from "../../lib/prisma.js";
import { DEFAULT_STAGES } from "./default-stages.js";
import type { CreateStageInput, UpdatePipelineInput, UpdateStageInput } from "./pipelines.schema.js";

export const countPipelines = (orgId: string) => prisma.pipeline.count({ where: { organizationId: orgId } });

export const listPipelines = (orgId: string) =>
  prisma.pipeline.findMany({
    where: { organizationId: orgId },
    include: { stages: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });

export const findPipeline = (orgId: string, id: string) =>
  prisma.pipeline.findFirst({ where: { id, organizationId: orgId } });

export const findPipelineWithStages = (orgId: string, id: string) =>
  prisma.pipeline.findFirst({
    where: { id, organizationId: orgId },
    include: { stages: { orderBy: { position: "asc" } } },
  });

// idempotente: chamada concorrente pode colidir no @@unique([organizationId, name]) (P2002),
// nesse caso a transação inteira é revertida e o service ignora o erro
export const createDefaultPipeline = (orgId: string) =>
  prisma.$transaction(async (tx) => {
    const pipeline = await tx.pipeline.create({
      data: { organizationId: orgId, name: "Funil de Vendas", isDefault: true, position: 0 },
    });
    await tx.stage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({
        organizationId: orgId,
        pipelineId: pipeline.id,
        name: stage.name,
        position: stage.position,
        isWon: stage.isWon ?? false,
        isLost: stage.isLost ?? false,
      })),
    });
    return pipeline;
  });

export const createPipeline = (orgId: string, name: string, position: number) =>
  prisma.pipeline.create({ data: { organizationId: orgId, name, position } });

export const createGenericStages = (orgId: string, pipelineId: string) =>
  prisma.stage.createMany({
    data: [
      { organizationId: orgId, pipelineId, name: "Novo", position: 0 },
      { organizationId: orgId, pipelineId, name: "Ganho", position: 1, isWon: true },
      { organizationId: orgId, pipelineId, name: "Perdido", position: 2, isLost: true },
    ],
  });

export const createStagesBulk = (
  orgId: string,
  pipelineId: string,
  stages: { name: string; color?: string; isWon?: boolean; isLost?: boolean }[],
) =>
  prisma.stage.createMany({
    data: stages.map((s, position) => ({
      organizationId: orgId,
      pipelineId,
      name: s.name,
      color: s.color,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
      position,
    })),
  });

export const updatePipelineById = (id: string, data: UpdatePipelineInput) =>
  prisma.pipeline.update({ where: { id }, data });

export const deletePipelineById = (id: string) => prisma.pipeline.delete({ where: { id } });

export const countDealsInPipeline = (pipelineId: string) => prisma.deal.count({ where: { pipelineId } });

export const findStageInOrg = (orgId: string, id: string) =>
  prisma.stage.findFirst({ where: { id, organizationId: orgId } });

export const findStagesInPipeline = (orgId: string, pipelineId: string) =>
  prisma.stage.findMany({ where: { organizationId: orgId, pipelineId } });

export const maxStagePosition = (pipelineId: string) =>
  prisma.stage.aggregate({ where: { pipelineId }, _max: { position: true } });

export const createStage = (orgId: string, pipelineId: string, position: number, data: CreateStageInput) =>
  prisma.stage.create({
    data: {
      organizationId: orgId,
      pipelineId,
      name: data.name,
      color: data.color,
      isWon: data.isWon ?? false,
      isLost: data.isLost ?? false,
      position,
    },
  });

export const updateStageById = (id: string, data: UpdateStageInput) => prisma.stage.update({ where: { id }, data });

export const deleteStageById = (id: string) => prisma.stage.delete({ where: { id } });

export const countStagesInPipeline = (pipelineId: string) => prisma.stage.count({ where: { pipelineId } });

export const countDealsInStage = (stageId: string) => prisma.deal.count({ where: { stageId } });

export const reorderStagesTx = (stageIds: string[]) =>
  prisma.$transaction(stageIds.map((id, position) => prisma.stage.update({ where: { id }, data: { position } })));
