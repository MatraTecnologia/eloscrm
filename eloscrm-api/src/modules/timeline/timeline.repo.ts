import { AttachmentStatus, AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Busca `limit` de cada fonte para a fusão em memória: o item mais recente do conjunto está sempre
 * entre os `limit` mais recentes de alguma fonte, então cortar depois de ordenar dá o mesmo resultado
 * de um cursor real — com quatro queries em vez de um union. Isso só vale se a query já ordenar pela
 * mesma chave que a fusão vai usar — daí a atividade virar três queries abaixo em vez de uma.
 */
export const sources = (orgId: string, clientId: string, limit: number) =>
  Promise.all([
    // a fusão ordena por doneAt ?? dueAt ?? createdAt; buscar tudo por createdAt deixaria de fora uma
    // atividade antiga concluída ontem, que é justamente a que deveria abrir a timeline
    prisma.activity.findMany({
      where: { organizationId: orgId, clientId, doneAt: { not: null } },
      orderBy: { doneAt: "desc" },
      take: limit,
    }),
    prisma.activity.findMany({
      where: { organizationId: orgId, clientId, doneAt: null, dueAt: { not: null } },
      orderBy: { dueAt: "desc" },
      take: limit,
    }),
    prisma.activity.findMany({
      where: { organizationId: orgId, clientId, doneAt: null, dueAt: null },
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
