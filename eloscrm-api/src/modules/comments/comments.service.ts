import type { Actor } from "../../lib/actor.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import * as repo from "./comments.repo.js";
import type { CreateCommentInput, ListCommentsQuery } from "./comments.schema.js";

const forbidden = (message: string) => httpError(403, "FORBIDDEN", message);

export const list = (orgId: string, filters: ListCommentsQuery) => repo.listComments(orgId, filters);

const getOwn = async (orgId: string, id: string) => {
  const comment = await repo.findComment(orgId, id);
  if (!comment) throw notFound("Comentário não encontrado");
  return comment;
};

export const create = (orgId: string, data: CreateCommentInput, actor: Actor) =>
  repo.createComment(orgId, data, actor);

export const update = async (orgId: string, id: string, body: string, actor: Actor) => {
  const comment = await getOwn(orgId, id);
  // editar é sempre do autor: gestor apaga o que não presta, mas não reescreve fala de ninguém
  if (comment.authorId !== actor.id) throw forbidden("Só o autor pode editar o comentário");
  return repo.updateCommentById(id, body);
};

export const remove = async (orgId: string, id: string, actor: Actor) => {
  const comment = await getOwn(orgId, id);
  if (comment.authorId !== actor.id && !(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só o autor ou um gestor pode remover o comentário");
  }
  await repo.deleteCommentById(id);
};
