import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as attachments from "../attachments/attachments.service.js";
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

// id no histórico não diz nada a quem lê; o nome é o que interessa. Serve estágio e funil, que
// mudam juntos na transferência.
const nameChange = (rows: { id: string; name: string }[], fromId: string, toId: string) => {
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return { from: byId.get(fromId) ?? null, to: byId.get(toId) ?? null };
};

const stageNames = async (orgId: string, fromId: string, toId: string) =>
  nameChange(
    await prisma.stage.findMany({
      where: { id: { in: [fromId, toId] }, organizationId: orgId },
      select: { id: true, name: true },
    }),
    fromId,
    toId,
  );

const pipelineNames = async (orgId: string, fromId: string, toId: string) =>
  nameChange(
    await prisma.pipeline.findMany({
      where: { id: { in: [fromId, toId] }, organizationId: orgId },
      select: { id: true, name: true },
    }),
    fromId,
    toId,
  );

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
  // O funil de destino manda na validação do estágio — checar contra o funil atual recusaria toda
  // transferência. O estágio já vem obrigatório junto do funil (ver o schema), e é ele quem prova
  // que o destino é desta imobiliária: `assertStageInOrgPipeline` só aceita estágio da org que
  // pertença ao funil informado.
  const targetPipelineId = data.pipelineId ?? deal.pipelineId;
  if (data.stageId) await assertStageInOrgPipeline(orgId, targetPipelineId, data.stageId);

  const updated = await repo.updateDealById(id, data);
  const changes = diffFields(deal, data);

  if (changes.stageId || changes.pipelineId) {
    // um PATCH pode mudar estágio e dono juntos; o movimento no funil é o que a timeline destaca
    const stage = changes.stageId ? await stageNames(orgId, deal.stageId, data.stageId!) : null;
    const pipeline = changes.pipelineId
      ? await pipelineNames(orgId, deal.pipelineId, data.pipelineId!)
      : null;
    delete changes.stageId;
    delete changes.pipelineId;
    await recordAudit({
      orgId,
      entityType: AuditEntity.DEAL,
      entityId: id,
      action: AuditAction.STAGE_CHANGED,
      actor,
      changes: { ...(pipeline ? { pipeline } : {}), ...(stage ? { stage } : {}), ...changes },
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

  // activities cascateiam do deal no schema; purgar os anexos delas antes, senão o objeto no
  // bucket privado fica sem ninguém que saiba dele depois do delete em cascata
  const dealActivities = await prisma.activity.findMany({
    where: { organizationId: orgId, dealId: id },
    select: { id: true },
  });
  await attachments.purgeForEntities(orgId, AuditEntity.DEAL, [id]);
  await attachments.purgeForEntities(
    orgId,
    AuditEntity.ACTIVITY,
    dealActivities.map((activity) => activity.id),
  );

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
