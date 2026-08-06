import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { ListAuditQuery } from "./audit.schema.js";

const whereOf = (orgId: string, filters: ListAuditQuery): Prisma.AuditEventWhereInput => {
  const where: Prisma.AuditEventWhereInput = { organizationId: orgId };

  if (filters.entityType) where.entityType = { in: filters.entityType };
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.action) where.action = { in: filters.action };
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.source) where.source = filters.source;
  if (filters.requestId) where.requestId = filters.requestId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.q) {
    // o rótulo é o que o gestor lembra ("o lead Ana Paula"); o id entra porque é o que ele tem quando
    // vem de um link, e o nome do ator porque "o que a Mariana fez" é a pergunta mais comum
    where.OR = [
      { entityLabel: { contains: filters.q, mode: "insensitive" } },
      { actorName: { contains: filters.q, mode: "insensitive" } },
      { entityId: filters.q },
    ];
  }
  return where;
};

export const listEvents = async (orgId: string, filters: ListAuditQuery) => {
  const items = await prisma.auditEvent.findMany({
    where: whereOf(orgId, filters),
    // id como desempate: dois eventos da mesma request compartilham o instante, e sem ele a página
    // seguinte poderia repetir ou pular linha
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filters.limit,
    ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
  });

  return { items, nextCursor: items.length === filters.limit ? items.at(-1)?.id : undefined };
};

/**
 * Atores distintos que aparecem no log, para o filtro da tela.
 *
 * Vem do próprio `AuditEvent` e não da lista de membros: quem saiu da imobiliária continua no
 * histórico, e um filtro que não o oferece esconde justamente o que se quer auditar.
 */
export const listActors = async (orgId: string) => {
  const rows = await prisma.auditEvent.groupBy({
    by: ["actorId", "actorName"],
    where: { organizationId: orgId },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });

  return rows.map((row) => ({
    actorId: row.actorId,
    actorName: row.actorName,
    events: row._count._all,
  }));
};

export const countEvents = (orgId: string, filters: ListAuditQuery) =>
  prisma.auditEvent.count({ where: whereOf(orgId, filters) });

/** Usado pelo export: sem `take`, com teto aplicado por quem chama. */
export const listAllEvents = (orgId: string, filters: ListAuditQuery, limit: number) =>
  prisma.auditEvent.findMany({
    where: whereOf(orgId, filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
