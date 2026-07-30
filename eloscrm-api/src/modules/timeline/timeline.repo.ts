import { AttachmentStatus, AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

/** Só lead e negócio têm timeline: são as entidades que juntam atividade, comentário e anexo. */
export type TimelineEntity = typeof AuditEntity.CLIENT | typeof AuditEntity.DEAL;

/**
 * Busca `limit` de cada fonte para a fusão em memória: o item mais recente do conjunto está sempre
 * entre os `limit` mais recentes de alguma fonte, então cortar depois de ordenar dá o mesmo resultado
 * de um cursor real — com quatro queries em vez de um union. Isso só vale se a query já ordenar pela
 * mesma chave que a fusão vai usar — daí a atividade virar três queries abaixo em vez de uma.
 */
export const sources = (
  orgId: string,
  entityType: TimelineEntity,
  entityId: string,
  limit: number,
) => {
  // a atividade se liga ao lead ou ao negócio por colunas diferentes; o resto das fontes é
  // endereçado pelo par (entityType, entityId) e não muda de forma
  const link = entityType === AuditEntity.DEAL ? { dealId: entityId } : { clientId: entityId };
  const entity = { organizationId: orgId, entityType, entityId };

  return Promise.all([
    // a fusão ordena por doneAt ?? dueAt ?? createdAt; buscar tudo por createdAt deixaria de fora uma
    // atividade antiga concluída ontem, que é justamente a que deveria abrir a timeline
    prisma.activity.findMany({
      where: { organizationId: orgId, ...link, doneAt: { not: null } },
      orderBy: { doneAt: "desc" },
      take: limit,
    }),
    prisma.activity.findMany({
      where: { organizationId: orgId, ...link, doneAt: null, dueAt: { not: null } },
      orderBy: { dueAt: "desc" },
      take: limit,
    }),
    prisma.activity.findMany({
      where: { organizationId: orgId, ...link, doneAt: null, dueAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.auditEvent.findMany({
      where: entity,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.comment.findMany({
      where: entity,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.attachment.findMany({
      where: { ...entity, status: AttachmentStatus.READY },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
};
