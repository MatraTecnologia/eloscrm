import { prisma } from "../../lib/prisma.js";
import type { CreateCommentInput, ListCommentsQuery } from "./comments.schema.js";

export const listComments = (orgId: string, filters: ListCommentsQuery) =>
  prisma.comment.findMany({
    where: { organizationId: orgId, entityType: filters.entityType, entityId: filters.entityId },
    orderBy: { createdAt: "desc" },
  });

export const findComment = (orgId: string, id: string) =>
  prisma.comment.findFirst({ where: { id, organizationId: orgId } });

export const createComment = (
  orgId: string,
  data: CreateCommentInput,
  author: { id: string; name: string },
) =>
  prisma.comment.create({
    data: { ...data, organizationId: orgId, authorId: author.id, authorName: author.name },
  });

export const updateCommentById = (id: string, body: string) =>
  prisma.comment.update({ where: { id }, data: { body, editedAt: new Date() } });

export const deleteCommentById = (id: string) => prisma.comment.delete({ where: { id } });

export const findMemberRole = async (orgId: string, userId: string) => {
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, userId },
    select: { role: true },
  });
  return member?.role ?? null;
};
