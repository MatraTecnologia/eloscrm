import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { assertStageInOrgPipeline } from "../pipelines/pipelines.service.js";
import * as repo from "./deals.repo.js";
import type { CreateDealInput, ListDealsQuery, UpdateDealInput } from "./deals.schema.js";

export const list = (orgId: string, filters: ListDealsQuery) => repo.listDeals(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const deal = await repo.findDeal(orgId, id);
  if (!deal) throw notFound("Negócio não encontrado");
  return deal;
};

const ensureRelationsInOrg = async (orgId: string, data: CreateDealInput | UpdateDealInput) => {
  if (data.clientId) {
    const client = await repo.findClientInOrg(orgId, data.clientId);
    if (!client) throw notFound("Cliente não encontrado");
  }
  if (data.propertyId) {
    const property = await repo.findPropertyInOrg(orgId, data.propertyId);
    if (!property) throw notFound("Imóvel não encontrado");
  }
};

// stageId no histórico não diz nada a quem lê; o nome do estágio é o que interessa
const stageNames = async (orgId: string, fromId: string, toId: string) => {
  const stages = await prisma.stage.findMany({
    where: { id: { in: [fromId, toId] }, organizationId: orgId },
    select: { id: true, name: true },
  });
  const byId = new Map(stages.map((stage) => [stage.id, stage.name]));
  return { from: byId.get(fromId) ?? null, to: byId.get(toId) ?? null };
};

export const create = async (orgId: string, data: CreateDealInput, actor: Actor) => {
  await ensureRelationsInOrg(orgId, data);
  await assertStageInOrgPipeline(orgId, data.pipelineId, data.stageId);
  const deal = await repo.createDeal(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: deal.id,
    action: AuditAction.CREATED,
    actor,
  });
  return deal;
};

export const update = async (orgId: string, id: string, data: UpdateDealInput, actor: Actor) => {
  const deal = await getById(orgId, id);
  await ensureRelationsInOrg(orgId, data);
  // mover um negócio é sempre dentro do mesmo pipeline: pipelineId do update é ignorado
  const { pipelineId: _pipelineId, ...rest } = data;
  if (rest.stageId) await assertStageInOrgPipeline(orgId, deal.pipelineId, rest.stageId);

  const updated = await repo.updateDealById(id, rest);
  const changes = diffFields(deal, rest);

  if (changes.stageId) {
    // um PATCH pode mudar estágio e dono juntos; o movimento no funil é o que a timeline destaca
    const names = await stageNames(orgId, deal.stageId, rest.stageId!);
    delete changes.stageId;
    await recordAudit({
      orgId,
      entityType: AuditEntity.DEAL,
      entityId: id,
      action: AuditAction.STAGE_CHANGED,
      actor,
      changes: { stage: names, ...changes },
    });
    return updated;
  }

  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: id,
    action: changes.ownerId ? AuditAction.OWNER_CHANGED : AuditAction.UPDATED,
    actor,
    changes,
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  await getById(orgId, id);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deleteDealById(id);
};
