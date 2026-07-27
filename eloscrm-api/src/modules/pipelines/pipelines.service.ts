import { httpError, notFound } from "../../lib/http-error.js";
import * as repo from "./pipelines.repo.js";
import type {
  CreatePipelineInput,
  CreateStageInput,
  ReorderStagesInput,
  UpdatePipelineInput,
  UpdateStageInput,
} from "./pipelines.schema.js";

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

export const ensureDefaultPipeline = async (orgId: string) => {
  const count = await repo.countPipelines(orgId);
  if (count > 0) return;
  try {
    await repo.createDefaultPipeline(orgId);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
};

export const list = async (orgId: string) => {
  await ensureDefaultPipeline(orgId);
  return repo.listPipelines(orgId);
};

export const getById = async (orgId: string, id: string) => {
  const pipeline = await repo.findPipeline(orgId, id);
  if (!pipeline) throw notFound("Pipeline não encontrado");
  return pipeline;
};

export const create = async (orgId: string, data: CreatePipelineInput) => {
  const position = await repo.countPipelines(orgId);
  const pipeline = await repo.createPipeline(orgId, data.name, position);
  if (data.stages?.length) await repo.createStagesBulk(orgId, pipeline.id, data.stages);
  else await repo.createGenericStages(orgId, pipeline.id);
  return repo.findPipelineWithStages(orgId, pipeline.id);
};

export const update = async (orgId: string, id: string, data: UpdatePipelineInput) => {
  await getById(orgId, id);
  return repo.updatePipelineById(id, data);
};

export const remove = async (orgId: string, id: string) => {
  await getById(orgId, id);
  const totalPipelines = await repo.countPipelines(orgId);
  if (totalPipelines <= 1) {
    throw httpError(409, "LAST_PIPELINE", "Não é possível remover o único pipeline da organização");
  }
  const dealsCount = await repo.countDealsInPipeline(id);
  if (dealsCount > 0) throw httpError(409, "PIPELINE_HAS_DEALS", "Não é possível remover um pipeline com negócios");
  await repo.deletePipelineById(id);
};

export const addStage = async (orgId: string, pipelineId: string, data: CreateStageInput) => {
  await getById(orgId, pipelineId);
  const maxAgg = await repo.maxStagePosition(pipelineId);
  const position = (maxAgg._max.position ?? -1) + 1;
  return repo.createStage(orgId, pipelineId, position, data);
};

export const reorderStages = async (orgId: string, pipelineId: string, data: ReorderStagesInput) => {
  await getById(orgId, pipelineId);
  const stages = await repo.findStagesInPipeline(orgId, pipelineId);
  const validIds = new Set(stages.map((stage) => stage.id));
  const allValid = data.stageIds.length === stages.length && data.stageIds.every((id) => validIds.has(id));
  if (!allValid) throw notFound("Estágio inválido");
  await repo.reorderStagesTx(data.stageIds);
  return repo.findPipelineWithStages(orgId, pipelineId);
};

export const updateStage = async (orgId: string, id: string, data: UpdateStageInput) => {
  const stage = await repo.findStageInOrg(orgId, id);
  if (!stage) throw notFound("Estágio não encontrado");
  return repo.updateStageById(id, data);
};

export const removeStage = async (orgId: string, id: string) => {
  const stage = await repo.findStageInOrg(orgId, id);
  if (!stage) throw notFound("Estágio não encontrado");
  const dealsCount = await repo.countDealsInStage(id);
  if (dealsCount > 0) throw httpError(409, "STAGE_HAS_DEALS", "Mova os negócios antes de remover o estágio");
  const stagesCount = await repo.countStagesInPipeline(stage.pipelineId);
  if (stagesCount <= 1) throw httpError(409, "LAST_STAGE", "Não é possível remover o único estágio do pipeline");
  await repo.deleteStageById(id);
};

// helper de isolamento de tenant: usado pelo módulo deals para validar que o stageId
// informado pertence ao pipeline (e à org) do negócio
export const assertStageInOrgPipeline = async (orgId: string, pipelineId: string, stageId: string) => {
  const stage = await repo.findStageInOrg(orgId, stageId);
  if (!stage || stage.pipelineId !== pipelineId) throw notFound("Estágio inválido");
  return stage;
};
