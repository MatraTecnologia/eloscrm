import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { truncate } from "../../lib/audit-snapshot.js";
import type { AnnotatableEntity } from "../../lib/entity-scopes.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import { prisma } from "../../lib/prisma.js";
import * as repo from "./comments.repo.js";
import type { CreateCommentInput, ListCommentsQuery } from "./comments.schema.js";

const forbidden = (message: string) => httpError(403, "FORBIDDEN", message);

// substantivo do alvo, o mesmo que a tela usa (eloscrm-web/lib/labels.ts ENTITY_NOUNS) — só o
// suficiente para compor o `entityLabel` do evento de comentário, que descreve o alvo, não o texto
const TARGET_NOUNS: Record<AnnotatableEntity, string> = {
  CLIENT: "lead",
  DEAL: "negócio",
  PROPERTY: "imóvel",
  ACTIVITY: "registro",
};

/** Nome que o alvo do comentário tinha no momento do fato — o que sobra depois de ele ser apagado. */
const findTargetLabel = async (
  entityType: AnnotatableEntity,
  entityId: string,
): Promise<string | null> => {
  switch (entityType) {
    case AuditEntity.CLIENT: {
      const client = await prisma.client.findUnique({ where: { id: entityId }, select: { name: true } });
      return client?.name ?? null;
    }
    case AuditEntity.DEAL: {
      const deal = await prisma.deal.findUnique({ where: { id: entityId }, select: { title: true } });
      return deal?.title ?? null;
    }
    case AuditEntity.PROPERTY: {
      const property = await prisma.property.findUnique({
        where: { id: entityId },
        select: { title: true },
      });
      return property?.title ?? null;
    }
    case AuditEntity.ACTIVITY: {
      const activity = await prisma.activity.findUnique({
        where: { id: entityId },
        select: { description: true },
      });
      return activity?.description ? truncate(activity.description) : null;
    }
  }
};

/**
 * O comentário em si já é o registro: o corpo é texto livre de pessoas e não entra na auditoria.
 * `entityLabel`/`context` descrevem o alvo (ex.: "lead Ana Paula"), não o que foi escrito.
 */
const auditComment = async (
  orgId: string,
  action: AuditAction,
  commentId: string,
  targetType: AnnotatableEntity,
  targetId: string,
  actor: Actor,
) => {
  const targetLabel = await findTargetLabel(targetType, targetId);
  const noun = TARGET_NOUNS[targetType];
  await recordAudit({
    orgId,
    entityType: AuditEntity.COMMENT,
    entityId: commentId,
    entityLabel: targetLabel ? `${noun} ${targetLabel}` : noun,
    action,
    actor,
    context: { targetType, targetLabel },
  });
};

export const list = (orgId: string, filters: ListCommentsQuery) => repo.listComments(orgId, filters);

const getOwn = async (orgId: string, id: string) => {
  const comment = await repo.findComment(orgId, id);
  if (!comment) throw notFound("Comentário não encontrado");
  return comment;
};

export const create = async (orgId: string, data: CreateCommentInput, actor: Actor) => {
  const comment = await repo.createComment(orgId, data, actor);
  await auditComment(orgId, AuditAction.CREATED, comment.id, data.entityType, data.entityId, actor);
  return comment;
};

export const update = async (orgId: string, id: string, body: string, actor: Actor) => {
  const comment = await getOwn(orgId, id);
  // editar é sempre do autor: gestor apaga o que não presta, mas não reescreve fala de ninguém
  if (comment.authorId !== actor.id) throw forbidden("Só o autor pode editar o comentário");
  const updated = await repo.updateCommentById(id, body);
  await auditComment(
    orgId,
    AuditAction.UPDATED,
    id,
    comment.entityType as AnnotatableEntity,
    comment.entityId,
    actor,
  );
  return updated;
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const comment = await getOwn(orgId, id);
  if (comment.authorId !== actor.id && !(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só o autor ou um gestor pode remover o comentário");
  }
  // o rótulo do alvo vem antes do delete, mesma regra do resto da auditoria: depois de apagado não
  // há mais de onde ler o comentário nem confirmar de qual lead/negócio ele falava
  await auditComment(
    orgId,
    AuditAction.DELETED,
    id,
    comment.entityType as AnnotatableEntity,
    comment.entityId,
    actor,
  );
  await repo.deleteCommentById(id);
};

/**
 * Apaga os comentários de entidades que deixaram de existir.
 *
 * `Comment` não tem FK para o alvo — o par (entityType, entityId) serve lead, negócio, imóvel e
 * atividade —, então o cascade do Postgres **não** o alcança: excluir um lead deixava os comentários
 * dele no banco para sempre, invisíveis (o feed busca por entityType+entityId) e carregando texto
 * escrito por pessoas. Mesmo motivo e mesma forma de `attachments.purgeForEntities`.
 */
export const purgeForEntities = async (orgId: string, entityType: AuditEntity, entityIds: string[]) => {
  if (entityIds.length === 0) return;
  await repo.deleteForEntities(orgId, entityType, entityIds);
};
