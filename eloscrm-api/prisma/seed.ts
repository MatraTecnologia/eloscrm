import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { AuditEntity } from "../src/generated/prisma/client.js";
import { DEFAULT_STAGES, type DefaultStage } from "../src/modules/pipelines/default-stages.js";
import {
  RENTAL_STAGES,
  activities,
  clients,
  comments,
  properties,
  rentalDeals,
  salesDeals,
} from "./seed-data.js";

const SALES_PIPELINE = "Funil de Vendas";
const RENTAL_PIPELINE = "Locação";

const at = (daysFromNow: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const daysAgo = (days: number) => at(-days, 9);

/**
 * O seed popula a organização de quem já usa o app — uma org sem membro nenhum não aparece para
 * ninguém. Só quando não existe nenhuma (clone novo, banco zerado) é que cria a de demonstração.
 */
const resolveOrg = async () => {
  const withMember = await prisma.organization.findFirst({
    where: { members: { some: {} } },
    orderBy: { createdAt: "asc" },
    include: { members: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (withMember) return { org: withMember, ownerId: withMember.members[0]?.userId ?? null };

  const org = await prisma.organization.create({
    data: { name: "Imobiliária Demo", slug: "imob-demo" },
  });
  return { org, ownerId: null };
};

/**
 * Deal.stageId é onDelete: Restrict, e apagar um pipeline cascateia para os estágios — então as
 * negociações precisam sair antes dos estágios, senão a segunda execução do seed quebra em FK.
 */
const wipeOrgData = async (organizationId: string) => {
  await prisma.comment.deleteMany({ where: { organizationId } });
  await prisma.activity.deleteMany({ where: { organizationId } });
  await prisma.deal.deleteMany({ where: { organizationId } });
  await prisma.client.deleteMany({ where: { organizationId } });
  await prisma.property.deleteMany({ where: { organizationId } });
  await prisma.stage.deleteMany({ where: { organizationId } });
  await prisma.pipeline.deleteMany({ where: { organizationId } });
};

const createPipeline = async (
  organizationId: string,
  name: string,
  isDefault: boolean,
  position: number,
  stages: DefaultStage[],
) => {
  const pipeline = await prisma.pipeline.create({
    data: { organizationId, name, isDefault, position },
  });
  const created = await Promise.all(
    stages.map((stage) =>
      prisma.stage.create({
        data: {
          organizationId,
          pipelineId: pipeline.id,
          name: stage.name,
          position: stage.position,
          isWon: stage.isWon ?? false,
          isLost: stage.isLost ?? false,
        },
      }),
    ),
  );
  return { pipeline, stageIds: new Map(created.map((stage) => [stage.name, stage.id])) };
};

const run = async () => {
  const { org, ownerId } = await resolveOrg();
  console.log(`Populando "${org.name}" (${org.slug})${ownerId ? "" : " — organização sem membros"}`);

  await wipeOrgData(org.id);

  // o funil do dashboard vem só do pipeline default: dois com isDefault true misturariam os
  // estágios dos dois num gráfico só
  const sales = await createPipeline(org.id, SALES_PIPELINE, true, 0, DEFAULT_STAGES);
  const rental = await createPipeline(org.id, RENTAL_PIPELINE, false, 1, RENTAL_STAGES);

  const propertyIds = new Map<string, string>();
  for (const property of properties) {
    const created = await prisma.property.create({
      data: { organizationId: org.id, photos: [], ...property },
    });
    propertyIds.set(created.title, created.id);
  }

  const clientIds = new Map<string, string>();
  for (const client of clients) {
    const created = await prisma.client.create({
      data: { organizationId: org.id, ownerId, ...client },
    });
    clientIds.set(created.name, created.id);
  }

  const dealIds = new Map<string, string>();
  for (const [deals, { pipeline, stageIds }] of [
    [salesDeals, sales],
    [rentalDeals, rental],
  ] as const) {
    for (const deal of deals) {
      const created = await prisma.deal.create({
        data: {
          organizationId: org.id,
          clientId: clientIds.get(deal.client)!,
          propertyId: deal.property ? propertyIds.get(deal.property)! : null,
          pipelineId: pipeline.id,
          stageId: stageIds.get(deal.stage)!,
          ownerId,
          title: deal.title,
          value: deal.value,
          lostReason: deal.lostReason ?? null,
          createdAt: daysAgo(deal.createdDaysAgo),
        },
      });
      dealIds.set(created.title, created.id);
    }
  }

  for (const activity of activities) {
    const dueAt = at(activity.dueInDays, activity.atHour);
    await prisma.activity.create({
      data: {
        organizationId: org.id,
        clientId: clientIds.get(activity.client)!,
        dealId: activity.deal ? dealIds.get(activity.deal)! : null,
        type: activity.type,
        description: activity.description,
        dueAt,
        doneAt: activity.done ? dueAt : null,
      },
    });
  }

  // sem membro na org (banco zerado), não há autor para assinar o comentário
  if (ownerId) {
    const author = await prisma.member.findFirst({
      where: { organizationId: org.id, userId: ownerId },
      select: { user: { select: { name: true } } },
    });
    for (const comment of comments) {
      await prisma.comment.create({
        data: {
          organizationId: org.id,
          entityType: AuditEntity.CLIENT,
          entityId: clientIds.get(comment.client)!,
          authorId: ownerId,
          authorName: author?.user.name ?? "Equipe",
          body: comment.body,
          createdAt: daysAgo(comment.daysAgo),
        },
      });
    }
  }

  console.log(
    `Pronto: ${properties.length} imóveis, ${clients.length} clientes, ` +
      `${salesDeals.length + rentalDeals.length} negociações em 2 funis, ` +
      `${activities.length} atividades, ${comments.length} comentários`,
  );
};

run().finally(() => prisma.$disconnect());
