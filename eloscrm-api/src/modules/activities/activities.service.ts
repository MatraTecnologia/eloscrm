import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
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
    action: AuditAction.CREATED,
    actor,
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
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  // getById antes do delete: o repo apaga só por id, e sem esta checagem o delete cruzaria tenants
  await getById(orgId, id);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.ACTIVITY,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deleteActivityById(id);
};
