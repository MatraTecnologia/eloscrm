import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { snapshotOf } from "../../lib/audit-snapshot.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as attachments from "../attachments/attachments.service.js";
import * as comments from "../comments/comments.service.js";
import { assertStageInOrgPipeline } from "../pipelines/pipelines.service.js";
import * as repo from "./deals.repo.js";
import type {
  BulkTransferDealsInput,
  CreateDealInput,
  ListDealsQuery,
  UpdateDealInput,
} from "./deals.schema.js";

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

/**
 * Onde o negócio estava, por nome — vai desnormalizado no evento.
 *
 * A tela de auditoria mostra "no funil Vendas, estágio Proposta" sem join, e continua mostrando depois
 * de o funil ou o lead terem sido apagados. É por isso que é nome, não id.
 */
const contextOf = async (
  orgId: string,
  deal: { clientId?: string | null; pipelineId: string; stageId: string },
) => {
  const [client, pipeline, stage] = await Promise.all([
    deal.clientId ? repo.findClientInOrg(orgId, deal.clientId) : null,
    prisma.pipeline.findFirst({
      where: { id: deal.pipelineId, organizationId: orgId },
      select: { name: true },
    }),
    prisma.stage.findFirst({
      where: { id: deal.stageId, organizationId: orgId },
      select: { name: true },
    }),
  ]);
  const context: Record<string, unknown> = {};
  if (client) context.clientName = client.name;
  if (pipeline) context.pipelineName = pipeline.name;
  if (stage) context.stageName = stage.name;
  return Object.keys(context).length ? context : undefined;
};

export const create = async (orgId: string, data: CreateDealInput, actor: Actor) => {
  await ensureRelationsInOrg(orgId, data);
  await assertStageInOrgPipeline(orgId, data.pipelineId, data.stageId);
  const deal = await repo.createDeal(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: deal.id,
    entityLabel: deal.title,
    action: AuditAction.CREATED,
    actor,
    context: await contextOf(orgId, deal),
    snapshot: snapshotOf(AuditEntity.DEAL, deal),
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
  const destino = data.stageId
    ? await assertStageInOrgPipeline(orgId, targetPipelineId, data.stageId)
    : null;

  // mesma regra do lote: quem sai da perda não leva o motivo junto. Sem isto, transferir por aqui e
  // transferir em lote deixariam o negócio em estados diferentes — e é o tipo de divergência que só
  // aparece quando alguém repara no "perdido porque…" de um negócio reaberto.
  const limpaPerda =
    destino && !destino.isLost && deal.lostReason && data.lostReason === undefined
      ? { lostReason: null }
      : {};
  const aplicado = { ...data, ...limpaPerda };
  const updated = await repo.updateDealById(id, aplicado);
  // o diff acompanha o que foi gravado, não o que veio no corpo: o motivo apagado por regra também
  // é mudança e precisa aparecer no histórico
  const changes = diffFields(deal, aplicado);

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
      entityLabel: deal.title,
      action: AuditAction.STAGE_CHANGED,
      actor,
      changes: { ...(pipeline ? { pipeline } : {}), ...(stage ? { stage } : {}), ...changes },
      context: await contextOf(orgId, { ...deal, pipelineId: targetPipelineId, stageId: data.stageId ?? deal.stageId }),
    });
    return updated;
  }

  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: id,
    entityLabel: (updated ?? deal).title,
    action: changes.ownerId ? AuditAction.OWNER_CHANGED : AuditAction.UPDATED,
    actor,
    changes,
    context: await contextOf(orgId, deal),
  });
  return updated;
};

/**
 * Transferir vários negócios de uma vez.
 *
 * Tudo ou nada: o `updateMany` e as linhas de histórico vão na mesma transação, porque metade dos
 * negócios num funil e metade no outro é pior do que nenhum — o corretor não tem como saber quais
 * passaram sem conferir cartão a cartão.
 */
export const bulkTransfer = async (
  orgId: string,
  { dealIds, pipelineId, stageId }: BulkTransferDealsInput,
  actor: Actor,
) => {
  // a contagem é a prova de que todos são desta imobiliária: sem ela, um id de outra org no meio da
  // lista seria ignorado em silêncio e o resto transferiria como se estivesse tudo certo
  const deals = await repo.findDealsInOrg(orgId, dealIds);
  if (deals.length !== dealIds.length) throw notFound("Negócio não encontrado");

  const destino = await assertStageInOrgPipeline(orgId, pipelineId, stageId);

  // quem já está exatamente no destino não vira linha de histórico dizendo que nada mudou
  const alvos = deals.filter((deal) => deal.pipelineId !== pipelineId || deal.stageId !== stageId);
  if (alvos.length === 0) return { transferred: 0 };

  // uma query para os nomes de todos os estágios e funis envolvidos: a origem varia por negócio, e
  // consultar dentro do laço multiplicaria as idas ao banco pelo tamanho do lote
  const [stages, pipelines] = await Promise.all([
    prisma.stage.findMany({
      where: { id: { in: [...new Set([...alvos.map((d) => d.stageId), stageId])] }, organizationId: orgId },
      select: { id: true, name: true },
    }),
    prisma.pipeline.findMany({
      where: {
        id: { in: [...new Set([...alvos.map((d) => d.pipelineId), pipelineId])] },
        organizationId: orgId,
      },
      select: { id: true, name: true },
    }),
  ]);
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  const pipelineName = new Map(pipelines.map((p) => [p.id, p.name]));

  const alvoIds = alvos.map((deal) => deal.id);
  // o createMany escreve os eventos na mão (é o que permite uma transação só com o updateMany), então
  // o que o recordAudit resolveria sozinho — nome da org e origem do ator — precisa vir junto aqui
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const orgName = org?.name ?? null;

  await prisma.$transaction([
    repo.transferDeals(orgId, alvoIds, {
      pipelineId,
      stageId,
      // mesma regra do movimento unitário: negócio que sai da perda não leva junto o motivo
      ...(destino.isLost ? {} : { lostReason: null }),
    }),
    prisma.auditEvent.createMany({
      data: alvos.map((deal) => ({
        organizationId: orgId,
        entityType: AuditEntity.DEAL,
        entityId: deal.id,
        entityLabel: deal.title,
        // ação própria: no log geral, "transferiu" separa o movimento em lote do arrasto de um cartão,
        // e o requestId comum é o que deixa a tela mostrar o lote como uma operação
        action: AuditAction.TRANSFERRED,
        source: actor.source ?? "USER",
        actorId: actor.id || null,
        actorName: actor.name,
        actorEmail: actor.email ?? null,
        organizationName: orgName,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
        changes: {
          ...(deal.pipelineId !== pipelineId
            ? {
                pipeline: {
                  from: pipelineName.get(deal.pipelineId) ?? null,
                  to: pipelineName.get(pipelineId) ?? null,
                },
              }
            : {}),
          ...(deal.stageId !== stageId
            ? {
                stage: {
                  from: stageName.get(deal.stageId) ?? null,
                  to: stageName.get(stageId) ?? null,
                },
              }
            : {}),
        },
      })),
    }),
  ]);

  return { transferred: alvos.length };
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const deal = await getById(orgId, id);

  // activities cascateiam do deal no schema; purgar os anexos delas antes, senão o objeto no
  // bucket privado fica sem ninguém que saiba dele depois do delete em cascata
  const dealActivities = await prisma.activity.findMany({
    where: { organizationId: orgId, dealId: id },
    select: { id: true },
  });
  const activityIds = dealActivities.map((activity) => activity.id);
  await attachments.purgeForEntities(orgId, AuditEntity.DEAL, [id]);
  await attachments.purgeForEntities(orgId, AuditEntity.ACTIVITY, activityIds);
  await comments.purgeForEntities(orgId, AuditEntity.DEAL, [id]);
  await comments.purgeForEntities(orgId, AuditEntity.ACTIVITY, activityIds);

  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.DEAL,
    entityId: id,
    // lidos antes do delete, junto do getById do começo: depois não há mais de onde tirar
    entityLabel: deal.title,
    action: AuditAction.DELETED,
    actor,
    context: await contextOf(orgId, deal),
    snapshot: snapshotOf(AuditEntity.DEAL, deal),
  });
  await repo.deleteDealById(id);
};
