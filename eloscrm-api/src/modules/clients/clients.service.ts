import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { snapshotOf } from "../../lib/audit-snapshot.js";
import { autoDealTitle } from "../../lib/deal-title.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as attachments from "../attachments/attachments.service.js";
import * as comments from "../comments/comments.service.js";
import * as repo from "./clients.repo.js";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "./clients.schema.js";

export const list = (orgId: string, filters: ListClientsQuery) => repo.listClients(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const client = await repo.findClient(orgId, id);
  if (!client) throw notFound("Cliente não encontrado");
  return client;
};

export const create = async (orgId: string, data: CreateClientInput, actor: Actor) => {
  const client = await repo.createClient(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: client.id,
    entityLabel: client.name,
    action: AuditAction.CREATED,
    actor,
    snapshot: snapshotOf(AuditEntity.CLIENT, client),
  });
  return client;
};

export const update = async (orgId: string, id: string, data: UpdateClientInput, actor: Actor) => {
  const before = await getById(orgId, id);
  const updated = await repo.updateClientById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    // nome do estado final: renomear o lead deve deixar o evento falando do nome novo
    entityLabel: updated?.name ?? before.name,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });

  if (updated && updated.name !== before.name) {
    await renameAutoTitledDeals(orgId, id, before.name, updated.name, actor);
  }
  return updated;
};

/**
 * Leva o nome novo para os cards que ainda o repetiam.
 *
 * O card do funil mostra o **título do negócio** em destaque e o nome do lead só na linha de baixo.
 * Título criado pela automação é derivado do nome, então renomear o lead sem trazê-lo junto fazia a
 * correção parecer perdida: a imobiliária salvava o nome e o card continuava chamando a pessoa pelo
 * telefone — "o nome não está salvando", relatado em 2026-08-10.
 *
 * Casa pelo título inteiro, não por prefixo: negócio rebatizado por gente não volta a se chamar como
 * a automação queria. Um evento por card, com o mesmo ator de quem renomeou — foi ele que causou.
 */
const renameAutoTitledDeals = async (
  orgId: string,
  clientId: string,
  from: string,
  to: string,
  actor: Actor,
) => {
  const deals = await prisma.deal.findMany({
    where: { organizationId: orgId, clientId, title: autoDealTitle(from) },
    select: { id: true },
  });

  for (const deal of deals) {
    await prisma.deal.update({ where: { id: deal.id }, data: { title: autoDealTitle(to) } });
    await recordAudit({
      orgId,
      entityType: AuditEntity.DEAL,
      entityId: deal.id,
      entityLabel: autoDealTitle(to),
      action: AuditAction.UPDATED,
      actor,
      changes: { title: { from: autoDealTitle(from), to: autoDealTitle(to) } },
    });
  }
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const client = await getById(orgId, id);

  // deals e activities cascateiam do cliente no schema; sem purgar os anexos deles aqui, o delete
  // em cascata do Postgres apaga a linha mas o objeto correspondente fica esquecido no bucket
  const deals = await prisma.deal.findMany({
    where: { organizationId: orgId, clientId: id },
    select: { id: true },
  });
  const dealIds = deals.map((deal) => deal.id);
  const clientActivities = await prisma.activity.findMany({
    where: {
      organizationId: orgId,
      // activity pode estar ligada só ao deal (clientId nulo) e ainda assim cascatear com o cliente
      OR: [{ clientId: id }, ...(dealIds.length ? [{ dealId: { in: dealIds } }] : [])],
    },
    select: { id: true },
  });

  const activityIds = clientActivities.map((activity) => activity.id);
  await attachments.purgeForEntities(orgId, AuditEntity.CLIENT, [id]);
  await attachments.purgeForEntities(orgId, AuditEntity.DEAL, dealIds);
  await attachments.purgeForEntities(orgId, AuditEntity.ACTIVITY, activityIds);
  // comentário também não tem FK: sem isto, o do lead e o dos negócios dele ficam órfãos no banco
  await comments.purgeForEntities(orgId, AuditEntity.CLIENT, [id]);
  await comments.purgeForEntities(orgId, AuditEntity.DEAL, dealIds);
  await comments.purgeForEntities(orgId, AuditEntity.ACTIVITY, activityIds);

  // o evento vem antes do delete: se gravar depois e a escrita do evento falhar, o cliente some sem deixar rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    // rótulo e snapshot saem do que foi lido no começo: depois do delete não há mais de onde tirar, e
    // é isto que faz o evento continuar legível quando o lead não existe mais
    entityLabel: client.name,
    action: AuditAction.DELETED,
    actor,
    context: { deals: dealIds.length, activities: clientActivities.length },
    snapshot: snapshotOf(AuditEntity.CLIENT, client),
  });
  await repo.deleteClientById(id);
};
