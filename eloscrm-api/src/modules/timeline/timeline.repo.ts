import { AttachmentStatus, AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Busca `limit` de cada fonte para a fusão em memória: o item mais recente do conjunto está sempre
 * entre os `limit` mais recentes de alguma fonte, então cortar depois de ordenar dá o mesmo resultado
 * de um cursor real — com quatro queries em vez de um union.
 */
export const sources = (orgId: string, clientId: string, limit: number) =>
  Promise.all([
    prisma.activity.findMany({
      where: { organizationId: orgId, clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.comment.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.attachment.findMany({
      where: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: clientId,
        status: AttachmentStatus.READY,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
