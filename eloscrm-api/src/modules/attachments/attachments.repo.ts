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
    // key é a localização no bucket privado; o tipo do web nem declara o campo, não devolver
    omit: { key: true },
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

export const listKeysForEntities = (orgId: string, entityType: AuditEntity, entityIds: string[]) =>
  prisma.attachment.findMany({
    where: { organizationId: orgId, entityType, entityId: { in: entityIds } },
    select: { key: true },
  });

export const deleteForEntities = (orgId: string, entityType: AuditEntity, entityIds: string[]) =>
  prisma.attachment.deleteMany({
    where: { organizationId: orgId, entityType, entityId: { in: entityIds } },
  });

/**
 * O anexo aponta para cliente, negócio, imóvel ou atividade; a existência dentro da org é checada aqui.
 *
 * Exaustivo de propósito: `AuditEntity` tem valores que não são anexáveis, e um `else` final os mandava
 * para `activity.findFirst` — falhava fechado, mas por acidente. Tipo desconhecido não existe.
 */
export const entityExistsInOrg = async (orgId: string, entityType: AuditEntity, entityId: string) => {
  const where = { id: entityId, organizationId: orgId };
  switch (entityType) {
    case "CLIENT":
      return !!(await prisma.client.findFirst({ where }));
    case "DEAL":
      return !!(await prisma.deal.findFirst({ where }));
    case "PROPERTY":
      return !!(await prisma.property.findFirst({ where }));
    case "ACTIVITY":
      return !!(await prisma.activity.findFirst({ where }));
    default:
      return false;
  }
};
