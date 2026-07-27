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

export const create = async (orgId: string, data: CreateActivityInput) => {
  await assertTenantRefs(orgId, data);
  return repo.createActivity(orgId, data);
};

export const update = async (orgId: string, id: string, data: UpdateActivityInput) => {
  await getById(orgId, id);
  await assertTenantRefs(orgId, data);
  return repo.updateActivityById(id, data);
};

export const remove = async (orgId: string, id: string) => {
  // getById antes do delete: o repo apaga só por id, e sem esta checagem o delete cruzaria tenants
  await getById(orgId, id);
  await repo.deleteActivityById(id);
};
