import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { CreateDealInput, ListDealsQuery, UpdateDealInput } from "./deals.schema.js";

// as etiquetas vão junto em toda leitura de negócio: o kanban pinta o chip sem segunda query, e
// só id/nome/cor — o resto da etiqueta não interessa a quem lê o negócio
const dealInclude = {
  tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
} satisfies Prisma.DealInclude;

export const listDeals = (orgId: string, filters: ListDealsQuery) => {
  const where: Prisma.DealWhereInput = { organizationId: orgId };
  if (filters.pipelineId) where.pipelineId = filters.pipelineId;
  if (filters.stageId) where.stageId = filters.stageId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.tagId) where.tags = { some: { id: filters.tagId } };
  return prisma.deal.findMany({ where, include: dealInclude, orderBy: { createdAt: "desc" } });
};

export const findDeal = (orgId: string, id: string) =>
  prisma.deal.findFirst({ where: { id, organizationId: orgId }, include: dealInclude });

export const createDeal = (orgId: string, { tagIds, ...data }: CreateDealInput) =>
  prisma.deal.create({
    data: {
      ...data,
      organizationId: orgId,
      ...(tagIds ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
    },
    include: dealInclude,
  });

// `set` e não `connect`: o corpo traz a lista final, então quem saiu dela é desligado junto
export const updateDealById = (id: string, { tagIds, ...data }: UpdateDealInput) =>
  prisma.deal.update({
    where: { id },
    data: { ...data, ...(tagIds ? { tags: { set: tagIds.map((tagId) => ({ id: tagId })) } } : {}) },
    include: dealInclude,
  });

export const findDealsInOrg = (orgId: string, ids: string[]) =>
  prisma.deal.findMany({ where: { id: { in: ids }, organizationId: orgId } });

// devolve a promise sem await: quem chama põe dentro de `$transaction` junto das linhas de histórico.
// O `organizationId` no where é redundante depois da checagem do service, e fica de propósito — é a
// última linha de defesa se um dia alguém chamar isto sem conferir os ids antes.
export const transferDeals = (
  orgId: string,
  ids: string[],
  data: { pipelineId: string; stageId: string; lostReason?: null },
) => prisma.deal.updateMany({ where: { id: { in: ids }, organizationId: orgId }, data });

export const deleteDealById = (id: string) => prisma.deal.delete({ where: { id } });

export const findClientInOrg = (orgId: string, clientId: string) =>
  prisma.client.findFirst({ where: { id: clientId, organizationId: orgId } });

export const findPropertyInOrg = (orgId: string, propertyId: string) =>
  prisma.property.findFirst({ where: { id: propertyId, organizationId: orgId } });
