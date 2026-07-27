import "dotenv/config";
import { ClientSource, ActivityType } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
import { DEFAULT_STAGES } from "../src/modules/pipelines/default-stages.js";

const clientsData = [
  { name: "Carlos Silva", source: ClientSource.SITE, stagePosition: 0 },
  { name: "Mariana Costa", source: ClientSource.INSTAGRAM, stagePosition: 1 },
  { name: "Lucas Almeida", source: ClientSource.INDICACAO, stagePosition: 2 },
  { name: "Ana Pereira", source: ClientSource.WHATSAPP, stagePosition: 3 },
];

const run = async () => {
  const org = await prisma.organization.upsert({
    where: { slug: "imob-demo" },
    update: {},
    create: { name: "Imobiliária Demo", slug: "imob-demo" },
  });

  const pipeline = await prisma.pipeline.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Funil de Vendas" } },
    update: {},
    create: { organizationId: org.id, name: "Funil de Vendas", isDefault: true, position: 0 },
  });

  const stages = [];
  for (const stageData of DEFAULT_STAGES) {
    // Stage não tem unique constraint (só Pipeline tem); idempotência via find + create
    const existing = await prisma.stage.findFirst({ where: { pipelineId: pipeline.id, name: stageData.name } });
    const stage =
      existing ??
      (await prisma.stage.create({
        data: {
          organizationId: org.id,
          pipelineId: pipeline.id,
          name: stageData.name,
          position: stageData.position,
          isWon: stageData.isWon ?? false,
          isLost: stageData.isLost ?? false,
        },
      }));
    stages.push(stage);
  }

  for (const c of clientsData) {
    const client = await prisma.client.create({
      data: { organizationId: org.id, name: c.name, source: c.source },
    });
    const stage = stages[c.stagePosition];
    await prisma.deal.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: `Negociação — ${c.name}`,
        value: 250000,
      },
    });
    await prisma.activity.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        type: ActivityType.CALL,
        description: `Primeiro contato com ${c.name}`,
        dueAt: new Date(),
      },
    });
  }
};

run().finally(() => prisma.$disconnect());
