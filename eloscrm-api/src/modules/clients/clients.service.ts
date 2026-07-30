import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as attachments from "../attachments/attachments.service.js";
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
    action: AuditAction.CREATED,
    actor,
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
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  await getById(orgId, id);

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

  await attachments.purgeForEntities(orgId, AuditEntity.CLIENT, [id]);
  await attachments.purgeForEntities(orgId, AuditEntity.DEAL, dealIds);
  await attachments.purgeForEntities(
    orgId,
    AuditEntity.ACTIVITY,
    clientActivities.map((activity) => activity.id),
  );

  // o evento vem antes do delete: se gravar depois e a escrita do evento falhar, o cliente some sem deixar rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.DELETED,
    actor,
  });
  await repo.deleteClientById(id);
};
