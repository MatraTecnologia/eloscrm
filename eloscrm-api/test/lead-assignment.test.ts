import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { pickOwner, resolveOwner } from "../src/modules/lead-automation/assignment.service.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";
let pipelineId = "";
let stageAbertoId = "";
let automationId = "";

/** Corretores da imobiliária, na ordem em que entraram. */
const corretores: string[] = [];

const criarCorretor = async (sufixo: string) => {
  const { orgId: propria } = await signUpWithOrg(
    app,
    `assign-${sufixo}-${stamp}@eloscrm.test`,
    `assign-${sufixo}-${stamp}`,
  );
  const { userId } = await prisma.member.findFirstOrThrow({ where: { organizationId: propria } });
  await prisma.member.create({ data: { organizationId: orgId, userId, role: "member" } });
  return userId;
};

beforeAll(async () => {
  app = await makeApp();
  const dono = await signUpWithOrg(app, `assign-${stamp}@eloscrm.test`, `assign-${stamp}`);
  orgId = dono.orgId;

  // o funil padrão nasce sob demanda, na primeira listagem — não no sign-up
  await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie: dono.cookie } });

  const pipeline = await prisma.pipeline.findFirstOrThrow({ where: { organizationId: orgId } });
  pipelineId = pipeline.id;
  stageAbertoId = (
    await prisma.stage.findFirstOrThrow({
      where: { pipelineId, isWon: false, isLost: false },
      orderBy: { position: "asc" },
    })
  ).id;

  corretores.push(await criarCorretor("a"), await criarCorretor("b"), await criarCorretor("c"));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** Liga a roleta com os corretores informados. */
const ligarRoleta = async (userIds: string[]) => {
  const automation = await prisma.leadAutomation.create({
    data: {
      organizationId: orgId,
      autoAssign: true,
      members: { create: userIds.map((userId) => ({ userId, active: true })) },
    },
  });
  automationId = automation.id;
  return automation;
};

const criarNegocio = async (ownerId: string, stageId = stageAbertoId) => {
  const cliente = await prisma.client.create({
    data: { organizationId: orgId, name: `Lead ${Math.random()}` },
  });
  return prisma.deal.create({
    data: {
      organizationId: orgId,
      clientId: cliente.id,
      pipelineId,
      stageId,
      ownerId,
      title: "carga",
    },
  });
};

beforeEach(async () => {
  await prisma.leadAutomation.deleteMany({ where: { organizationId: orgId } });
  await prisma.deal.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
});

describe("roleta de distribuição", () => {
  it("com todos em zero, faz rodízio — não empilha no primeiro", async () => {
    await ligarRoleta(corretores);

    const sorteados = [await pickOwner(orgId), await pickOwner(orgId), await pickOwner(orgId)];

    // é o comportamento na estreia: sem o desempate por lastAssignedAt, os três seriam o mesmo
    expect(new Set(sorteados).size).toBe(3);
    expect(sorteados.every((id) => id && corretores.includes(id))).toBe(true);
  });

  it("vai para quem tem menos negócio aberto", async () => {
    await ligarRoleta(corretores);
    await criarNegocio(corretores[0]!);
    await criarNegocio(corretores[0]!);
    await criarNegocio(corretores[1]!);

    expect(await pickOwner(orgId)).toBe(corretores[2]!);
  });

  it("negócio ganho não pesa — a roleta não pune quem vende", async () => {
    await ligarRoleta([corretores[0]!, corretores[1]!]);
    const ganho = await prisma.stage.findFirstOrThrow({ where: { pipelineId, isWon: true } });
    await criarNegocio(corretores[0]!, ganho.id);
    await criarNegocio(corretores[1]!);

    expect(await pickOwner(orgId)).toBe(corretores[0]!);
  });

  it("quem saiu da imobiliária não recebe, mesmo ativo na configuração", async () => {
    const saindo = await criarCorretor("saiu");
    await ligarRoleta([saindo, corretores[0]!]);
    // a linha em LeadAutomationMember continua ativa; quem manda é a interseção com Member
    await prisma.member.deleteMany({ where: { organizationId: orgId, userId: saindo } });

    expect(await pickOwner(orgId)).toBe(corretores[0]!);
  });

  it("sem ninguém elegível devolve nulo — lead sem dono é melhor que lead que não existe", async () => {
    await ligarRoleta([]);
    expect(await pickOwner(orgId)).toBeNull();
  });

  it("chave desligada não distribui", async () => {
    const automation = await ligarRoleta(corretores);
    await prisma.leadAutomation.update({
      where: { id: automation.id },
      data: { autoAssign: false },
    });

    expect(await pickOwner(orgId)).toBeNull();
  });

  it("sem configuração nenhuma devolve nulo, sem estourar", async () => {
    expect(await pickOwner(orgId)).toBeNull();
  });

  it("rajada simultânea distribui por igual, não empilha", async () => {
    await ligarRoleta(corretores);

    // seis mensagens no mesmo instante, três corretores: cada um tem de sair exatamente duas vezes.
    // Sem o FOR UPDATE as transações leem a mesma carga e o mesmo lastAssignedAt, escolhem o mesmo
    // corretor, e a distribuição sai torta — que é o sintoma exato que a roleta existe para evitar.
    const sorteados = await Promise.all(Array.from({ length: 6 }, () => pickOwner(orgId)));

    const porCorretor = corretores.map(
      (userId) => sorteados.filter((escolhido) => escolhido === userId).length,
    );
    expect(porCorretor).toEqual([2, 2, 2]);
  });

  it("marca a rodada em quem recebeu", async () => {
    await ligarRoleta([corretores[0]!]);

    const escolhido = await pickOwner(orgId);
    const membro = await prisma.leadAutomationMember.findFirstOrThrow({
      where: { automationId, userId: escolhido! },
    });
    expect(membro.lastAssignedAt).not.toBeNull();
  });
});

describe("resolveOwner", () => {
  it("lead que já tem dono não passa pela roleta", async () => {
    await ligarRoleta(corretores);

    // herda: quem atende o cliente é quem deve ver o card novo
    expect(await resolveOwner(orgId, corretores[1]!)).toBe(corretores[1]!);

    const intocado = await prisma.leadAutomationMember.findMany({
      where: { automationId, lastAssignedAt: { not: null } },
    });
    // nem consumiu a vez de ninguém
    expect(intocado).toHaveLength(0);
  });

  it("lead órfão entra na roleta", async () => {
    await ligarRoleta([corretores[0]!]);
    expect(await resolveOwner(orgId, null)).toBe(corretores[0]!);
  });
});
