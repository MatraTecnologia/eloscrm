import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { snapshotOf } from "../../lib/audit-snapshot.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
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

export const create = async (orgId: string, data: CreatePipelineInput, actor: Actor) => {
  const position = await repo.countPipelines(orgId);
  const pipeline = await repo.createPipeline(orgId, data.name, position);
  if (data.stages?.length) await repo.createStagesBulk(orgId, pipeline.id, data.stages);
  else await repo.createGenericStages(orgId, pipeline.id);
  const result = await repo.findPipelineWithStages(orgId, pipeline.id);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PIPELINE,
    entityId: pipeline.id,
    entityLabel: pipeline.name,
    action: AuditAction.CREATED,
    actor,
    // os nomes, não a contagem: funil nasce de um template (ou dos genéricos), e "6" não diz qual.
    // O template escolhido não chega à API — só os estágios —, então a lista É o registro dele.
    context: { stages: (result?.stages ?? []).map((stage) => stage.name) },
    snapshot: snapshotOf(AuditEntity.PIPELINE, pipeline),
  });
  return result;
};

export const update = async (orgId: string, id: string, data: UpdatePipelineInput, actor: Actor) => {
  const before = await getById(orgId, id);
  const updated = await repo.updatePipelineById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PIPELINE,
    entityId: id,
    entityLabel: updated.name,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
    snapshot: snapshotOf(AuditEntity.PIPELINE, updated),
  });
  return updated;
};

/**
 * Se o funil pode ser excluído, e o que impede.
 *
 * A tela precisa disto porque as duas recusas do `remove` são situações que o gestor resolve de
 * formas diferentes: negócio dentro do funil se **transfere** (ou se fecha), e "é o único funil" se
 * resolve criando outro. Um toast de uma linha não distingue as duas nem diz quanto trabalho dá.
 */
export const deletionPreview = async (orgId: string, id: string) => {
  const pipeline = await getById(orgId, id);
  const stages = await repo.findStagesInPipeline(orgId, id);

  const [totalPipelines, deals, abertos, porEstagio] = await Promise.all([
    repo.countPipelines(orgId),
    prisma.deal.count({ where: { organizationId: orgId, pipelineId: id } }),
    prisma.deal.count({
      where: { organizationId: orgId, pipelineId: id, stage: { isWon: false, isLost: false } },
    }),
    prisma.deal.groupBy({
      by: ["stageId"],
      where: { organizationId: orgId, pipelineId: id },
      _count: { _all: true },
    }),
  ]);

  const blockers: { code: string; message: string }[] = [];
  if (deals > 0) {
    blockers.push({
      code: "PIPELINE_HAS_DEALS",
      message: "Transfira ou feche os negócios deste funil antes de excluí-lo",
    });
  }
  if (totalPipelines <= 1) {
    blockers.push({
      code: "LAST_PIPELINE",
      message: "A imobiliária precisa de pelo menos um funil",
    });
  }

  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: stages.map((stage) => stage.name),
    deals: { total: deals, open: abertos, closed: deals - abertos },
    // ordenado pela posição do estágio, para a lista ler na mesma ordem do kanban
    dealsByStage: stages
      .map((stage) => ({
        stage: stage.name,
        count: porEstagio.find((row) => row.stageId === stage.id)?._count._all ?? 0,
      }))
      .filter((row) => row.count > 0),
    canDelete: blockers.length === 0,
    blockers,
    // eco para a tela não precisar de outra consulta só para saber se é o último
    totalPipelines,
  };
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const pipeline = await getById(orgId, id);
  const totalPipelines = await repo.countPipelines(orgId);
  if (totalPipelines <= 1) {
    throw httpError(409, "LAST_PIPELINE", "Não é possível remover o único pipeline da organização");
  }
  const dealsCount = await repo.countDealsInPipeline(id);
  if (dealsCount > 0) throw httpError(409, "PIPELINE_HAS_DEALS", "Não é possível remover um pipeline com negócios");
  // os estágios cascateiam com o funil: lidos aqui, ou o evento não diz quais colunas existiam
  const stages = await repo.findStagesInPipeline(orgId, id);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.PIPELINE,
    entityId: id,
    entityLabel: pipeline.name,
    action: AuditAction.DELETED,
    actor,
    context: { stages: stages.map((stage) => stage.name) },
    snapshot: snapshotOf(AuditEntity.PIPELINE, pipeline),
  });
  await repo.deletePipelineById(id);
};

export const addStage = async (orgId: string, pipelineId: string, data: CreateStageInput, actor: Actor) => {
  const pipeline = await getById(orgId, pipelineId);
  const maxAgg = await repo.maxStagePosition(pipelineId);
  const position = (maxAgg._max.position ?? -1) + 1;
  const stage = await repo.createStage(orgId, pipelineId, position, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.STAGE,
    entityId: stage.id,
    entityLabel: stage.name,
    action: AuditAction.CREATED,
    actor,
    context: { pipelineName: pipeline.name },
    snapshot: snapshotOf(AuditEntity.STAGE, stage),
  });
  return stage;
};

export const reorderStages = async (orgId: string, pipelineId: string, data: ReorderStagesInput, actor: Actor) => {
  const pipeline = await getById(orgId, pipelineId);
  const stages = await repo.findStagesInPipeline(orgId, pipelineId);
  const validIds = new Set(stages.map((stage) => stage.id));
  const allValid = data.stageIds.length === stages.length && data.stageIds.every((id) => validIds.has(id));
  if (!allValid) throw notFound("Estágio inválido");
  // nomes, não ids: o evento precisa continuar legível depois de um estágio ser apagado
  const nameById = new Map(stages.map((stage) => [stage.id, stage.name]));
  await repo.reorderStagesTx(data.stageIds);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PIPELINE,
    entityId: pipelineId,
    entityLabel: pipeline.name,
    action: AuditAction.REORDERED,
    actor,
    changes: {
      order: {
        from: stages.map((stage) => stage.name),
        to: data.stageIds.map((id) => nameById.get(id)),
      },
    },
  });
  return repo.findPipelineWithStages(orgId, pipelineId);
};

export const updateStage = async (orgId: string, id: string, data: UpdateStageInput, actor: Actor) => {
  const stage = await repo.findStageInOrg(orgId, id);
  if (!stage) throw notFound("Estágio não encontrado");
  const updated = await repo.updateStageById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.STAGE,
    entityId: id,
    entityLabel: updated.name,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(stage, data),
    context: { pipelineName: stage.pipeline.name },
    snapshot: snapshotOf(AuditEntity.STAGE, updated),
  });
  return updated;
};

export const removeStage = async (orgId: string, id: string, actor: Actor) => {
  const stage = await repo.findStageInOrg(orgId, id);
  if (!stage) throw notFound("Estágio não encontrado");
  const dealsCount = await repo.countDealsInStage(id);
  if (dealsCount > 0) throw httpError(409, "STAGE_HAS_DEALS", "Mova os negócios antes de remover o estágio");
  const stagesCount = await repo.countStagesInPipeline(stage.pipelineId);
  if (stagesCount <= 1) throw httpError(409, "LAST_STAGE", "Não é possível remover o único estágio do pipeline");
  // rótulo e contexto lidos antes do delete: depois da linha sumir não há mais o que ler
  await recordAudit({
    orgId,
    entityType: AuditEntity.STAGE,
    entityId: id,
    entityLabel: stage.name,
    action: AuditAction.DELETED,
    actor,
    context: { pipelineName: stage.pipeline.name },
    snapshot: snapshotOf(AuditEntity.STAGE, stage),
  });
  await repo.deleteStageById(id);
};

// helper de isolamento de tenant: usado pelo módulo deals para validar que o stageId
// informado pertence ao pipeline (e à org) do negócio
export const assertStageInOrgPipeline = async (orgId: string, pipelineId: string, stageId: string) => {
  const stage = await repo.findStageInOrg(orgId, stageId);
  if (!stage || stage.pipelineId !== pipelineId) throw notFound("Estágio inválido");
  return stage;
};
