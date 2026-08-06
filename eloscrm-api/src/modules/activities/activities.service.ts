import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { snapshotOf, truncate } from "../../lib/audit-snapshot.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as attachments from "../attachments/attachments.service.js";
import * as comments from "../comments/comments.service.js";
import * as repo from "./activities.repo.js";
import type { CreateActivityInput, ListActivitiesQuery, UpdateActivityInput } from "./activities.schema.js";

const assertTenantRefs = async (orgId: string, data: CreateActivityInput | UpdateActivityInput) => {
  if (data.clientId) {
    const client = await prisma.client.findFirst({ where: { id: data.clientId, organizationId: orgId } });
    if (!client) throw notFound("Cliente não encontrado");
  }
  if (data.dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: data.dealId, organizationId: orgId } });
    if (!deal) throw notFound("Negociação não encontrada");
  }
};

/**
 * A que lead/negócio a atividade pertencia, por nome.
 *
 * Vai desnormalizado no evento porque o log é consultado depois de o lead poder já não existir — e aí
 * não há mais join que resolva o nome.
 */
const contextOf = async (orgId: string, data: { clientId?: string | null; dealId?: string | null }) => {
  const [client, deal] = await Promise.all([
    data.clientId
      ? prisma.client.findFirst({ where: { id: data.clientId, organizationId: orgId }, select: { name: true } })
      : null,
    data.dealId
      ? prisma.deal.findFirst({ where: { id: data.dealId, organizationId: orgId }, select: { title: true } })
      : null,
  ]);
  const context: Record<string, unknown> = {};
  if (client) context.clientName = client.name;
  if (deal) context.dealTitle = deal.title;
  return Object.keys(context).length ? context : undefined;
};

export const list = (orgId: string, filters: ListActivitiesQuery) => repo.listActivities(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const activity = await repo.findActivity(orgId, id);
  if (!activity) throw notFound("Atividade não encontrada");
  return activity;
};

export const create = async (orgId: string, data: CreateActivityInput, actor: Actor) => {
  await assertTenantRefs(orgId, data);
  const activity = await repo.createActivity(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: activity.id,
    // descrição é texto livre: serve de rótulo, mas em uma linha
    entityLabel: truncate(activity.description),
    action: AuditAction.CREATED,
    actor,
    context: await contextOf(orgId, activity),
    snapshot: snapshotOf(AuditEntity.ACTIVITY, activity),
  });
  return activity;
};

export const update = async (orgId: string, id: string, data: UpdateActivityInput, actor: Actor) => {
  const before = await getById(orgId, id);
  await assertTenantRefs(orgId, data);
  const updated = await repo.updateActivityById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: id,
    entityLabel: truncate((updated ?? before).description),
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
    context: await contextOf(orgId, updated ?? before),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  // getById antes do delete: o repo apaga só por id, e sem esta checagem o delete cruzaria tenants
  const activity = await getById(orgId, id);
  // activity é alvo direto de anexo (não só colateral de cascata de cliente/deal): sem purgar aqui,
  // apagar a atividade direto deixaria o objeto correspondente esquecido no bucket privado
  await attachments.purgeForEntities(orgId, AuditEntity.ACTIVITY, [id]);
  await comments.purgeForEntities(orgId, AuditEntity.ACTIVITY, [id]);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: id,
    entityLabel: truncate(activity.description),
    action: AuditAction.DELETED,
    actor,
    context: await contextOf(orgId, activity),
    snapshot: snapshotOf(AuditEntity.ACTIVITY, activity),
  });
  await repo.deleteActivityById(id);
};
