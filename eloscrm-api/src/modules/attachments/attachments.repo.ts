import { AttachmentStatus, type AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ListAttachmentsQuery } from "./attachments.schema.js";

export const listReady = (orgId: string, filters: ListAttachmentsQuery) =>
  prisma.attachment.findMany({
    where: {
      organizationId: orgId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      status: AttachmentStatus.READY,
    },
    orderBy: { createdAt: "desc" },
  });

export const findAttachment = (orgId: string, id: string) =>
  prisma.attachment.findFirst({ where: { id, organizationId: orgId } });

export const createPending = (data: {
  organizationId: string;
  entityType: AuditEntity;
  entityId: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedById: string;
  uploadedByName: string;
}) => prisma.attachment.create({ data });

export const markReady = (id: string, size: number) =>
  prisma.attachment.update({ where: { id }, data: { status: AttachmentStatus.READY, size } });

export const deleteAttachmentById = (id: string) => prisma.attachment.delete({ where: { id } });

// o anexo aponta para cliente, negócio, imóvel ou atividade; a existência dentro da org é checada aqui
export const entityExistsInOrg = async (orgId: string, entityType: AuditEntity, entityId: string) => {
  const where = { id: entityId, organizationId: orgId };
  if (entityType === "CLIENT") return !!(await prisma.client.findFirst({ where }));
  if (entityType === "DEAL") return !!(await prisma.deal.findFirst({ where }));
  if (entityType === "PROPERTY") return !!(await prisma.property.findFirst({ where }));
  return !!(await prisma.activity.findFirst({ where }));
};
