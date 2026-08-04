import { prisma } from "../../lib/prisma.js";
import type { UpdateLeadAutomationInput } from "./lead-automation.schema.js";

const withMembers = { members: { select: { userId: true, active: true, lastAssignedAt: true } } };

/**
 * A configuração é criada na primeira leitura, com tudo desligado.
 *
 * Assim nem a tela nem a ingestão precisam tratar "ainda não existe" — e o padrão desligado é o
 * único aceitável: automação que nasce ligada mexeria no funil de quem nunca pediu.
 */
export const findOrCreate = async (orgId: string) => {
  const existing = await prisma.leadAutomation.findUnique({
    where: { organizationId: orgId },
    include: withMembers,
  });
  if (existing) return existing;

  return prisma.leadAutomation.create({
    data: { organizationId: orgId },
    include: withMembers,
  });
};

export const save = async (orgId: string, data: UpdateLeadAutomationInput) => {
  const automation = await findOrCreate(orgId);

  // `deleteMany` + `createMany` perderia o `lastAssignedAt` de quem continua na roleta, e o
  // desempate voltaria à estaca zero a cada vez que o gestor abrisse a tela e salvasse
  await prisma.$transaction([
    prisma.leadAutomation.update({
      where: { id: automation.id },
      data: {
        autoCreateClient: data.autoCreateClient,
        autoCreateDeal: data.autoCreateDeal,
        pipelineId: data.pipelineId,
        stageId: data.stageId,
        autoAssign: data.autoAssign,
      },
    }),
    prisma.leadAutomationMember.updateMany({
      where: { automationId: automation.id },
      data: { active: false },
    }),
    ...data.memberUserIds.map((userId) =>
      prisma.leadAutomationMember.upsert({
        where: { automationId_userId: { automationId: automation.id, userId } },
        create: { automationId: automation.id, userId, active: true },
        update: { active: true },
      }),
    ),
  ]);

  return findOrCreate(orgId);
};
