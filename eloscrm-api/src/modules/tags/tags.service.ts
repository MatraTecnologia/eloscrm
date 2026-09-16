import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { httpError, notFound } from "../../lib/http-error.js";
import * as repo from "./tags.repo.js";
import type { CreateTagInput, UpdateTagInput } from "./tags.schema.js";

export const list = (orgId: string) => repo.listTags(orgId);

export const getById = async (orgId: string, id: string) => {
  const tag = await repo.findTag(orgId, id);
  if (!tag) throw notFound("Etiqueta não encontrada");
  return tag;
};

// 409 e não 422: o corpo é válido, o que existe é uma etiqueta com o mesmo nome. O unique do banco
// pegaria também, mas viraria 500 — e a tela precisa do código para dizer "já existe".
const assertNameFree = async (orgId: string, name: string, exceptId?: string) => {
  const existing = await repo.findTagByName(orgId, name);
  if (existing && existing.id !== exceptId) {
    throw httpError(409, "TAG_NAME_TAKEN", "Já existe uma etiqueta com esse nome");
  }
};

export const create = async (orgId: string, data: CreateTagInput, actor: Actor) => {
  await assertNameFree(orgId, data.name);
  const tag = await repo.createTag(orgId, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.TAG,
    entityId: tag.id,
    entityLabel: tag.name,
    action: AuditAction.CREATED,
    actor,
    snapshot: { color: tag.color },
  });
  return tag;
};

export const update = async (orgId: string, id: string, data: UpdateTagInput, actor: Actor) => {
  const tag = await getById(orgId, id);
  if (data.name) await assertNameFree(orgId, data.name, id);
  const updated = await repo.updateTagById(id, data);
  await recordAudit({
    orgId,
    entityType: AuditEntity.TAG,
    entityId: id,
    entityLabel: updated.name,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(tag, data),
  });
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const tag = await getById(orgId, id);
  // quantos negócios perdem a etiqueta vai no evento: depois do delete não há mais de onde contar
  const dealCount = await repo.countDealsWithTag(orgId, id);
  await recordAudit({
    orgId,
    entityType: AuditEntity.TAG,
    entityId: id,
    entityLabel: tag.name,
    action: AuditAction.DELETED,
    actor,
    snapshot: { color: tag.color, dealCount },
  });
  await repo.deleteTagById(id);
};

/**
 * Prova que todas as etiquetas são desta imobiliária, pela contagem: um id de outra org no meio da
 * lista seria ignorado em silêncio pelo `connect`, e o negócio ficaria com menos etiquetas do que
 * a tela mandou. Devolve as linhas porque o histórico do negócio grava nomes, não ids.
 */
export const assertTagsInOrg = async (orgId: string, ids: string[]) => {
  if (ids.length === 0) return [];
  const tags = await repo.findTagsInOrg(orgId, ids);
  if (tags.length !== ids.length) throw notFound("Etiqueta não encontrada");
  return tags;
};
