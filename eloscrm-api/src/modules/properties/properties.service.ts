import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { labelOf, snapshotOf } from "../../lib/audit-snapshot.js";
import { notFound } from "../../lib/http-error.js";
import * as attachments from "../attachments/attachments.service.js";
import * as comments from "../comments/comments.service.js";
import * as repo from "./properties.repo.js";
import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from "./properties.schema.js";

export const list = (orgId: string, filters: ListPropertiesQuery) => repo.listProperties(orgId, filters);

export const getById = async (orgId: string, id: string) => {
  const property = await repo.findProperty(orgId, id);
  if (!property) throw notFound("Imóvel não encontrado");
  return property;
};

export const create = async (orgId: string, data: CreatePropertyInput, actor: Actor) => {
  const property = await repo.createProperty(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PROPERTY,
    entityId: property.id,
    entityLabel: labelOf(property),
    action: AuditAction.CREATED,
    actor,
    snapshot: snapshotOf(AuditEntity.PROPERTY, property),
  });
  return property;
};

export const update = async (orgId: string, id: string, data: UpdatePropertyInput, actor: Actor) => {
  const before = await getById(orgId, id);
  const updated = await repo.updatePropertyById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.PROPERTY,
    entityId: id,
    // rótulo do estado final: renomear o imóvel deve deixar o evento falando do nome novo
    entityLabel: labelOf(updated ?? before),
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(before, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const property = await getById(orgId, id);
  // deal.propertyId é SetNull no schema (não cascateia): só o imóvel precisa ter os anexos purgados
  await attachments.purgeForEntities(orgId, AuditEntity.PROPERTY, [id]);
  await comments.purgeForEntities(orgId, AuditEntity.PROPERTY, [id]);
  // o evento vem antes do delete: gravado depois, uma falha na escrita apagaria o registro sem rastro
  await recordAudit({
    orgId,
    entityType: AuditEntity.PROPERTY,
    entityId: id,
    // rótulo e snapshot vêm do que foi lido acima: depois do delete não há mais de onde tirar
    entityLabel: labelOf(property),
    action: AuditAction.DELETED,
    actor,
    snapshot: snapshotOf(AuditEntity.PROPERTY, property),
  });
  await repo.deletePropertyById(id);
};
