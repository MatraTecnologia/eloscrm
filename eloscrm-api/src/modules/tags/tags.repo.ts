import { prisma } from "../../lib/prisma.js";
import type { CreateTagInput, UpdateTagInput } from "./tags.schema.js";

export const listTags = (orgId: string) =>
  prisma.tag.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });

export const findTag = (orgId: string, id: string) =>
  prisma.tag.findFirst({ where: { id, organizationId: orgId } });

export const findTagByName = (orgId: string, name: string) =>
  prisma.tag.findUnique({ where: { organizationId_name: { organizationId: orgId, name } } });

export const findTagsInOrg = (orgId: string, ids: string[]) =>
  prisma.tag.findMany({ where: { id: { in: ids }, organizationId: orgId } });

export const createTag = (orgId: string, data: CreateTagInput) =>
  prisma.tag.create({ data: { ...data, organizationId: orgId } });

export const updateTagById = (id: string, data: UpdateTagInput) =>
  prisma.tag.update({ where: { id }, data });

export const deleteTagById = (id: string) => prisma.tag.delete({ where: { id } });

export const countDealsWithTag = (orgId: string, id: string) =>
  prisma.deal.count({ where: { organizationId: orgId, tags: { some: { id } } } });
