import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { asCookie, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let userId = "";
let cookieB = "";
let orgIdB = "";

type Pipeline = { id: string; name: string; stages: { id: string; name: string }[] };

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `auto-${stamp}@eloscrm.test`, `auto-${stamp}`));
  ({ cookie: cookieB, orgId: orgIdB } = await signUpWithOrg(
    app,
    `auto-b-${stamp}@eloscrm.test`,
    `auto-b-${stamp}`,
  ));
  // o helper não devolve o userId; quem criou a org é o único membro dela
  userId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId } })).userId;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.leadAutomation.deleteMany({ where: { organizationId: orgId } });
  // a carga é contada por negócio aberto: sem limpar, o deal de um teste vira a carga do seguinte
  await prisma.deal.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
});

const get = (c = cookie) =>
  app.inject({ method: "GET", url: "/v1/lead-automation", headers: { cookie: c } });

const put = (payload: Record<string, unknown>, c = cookie) =>
  app.inject({ method: "PUT", url: "/v1/lead-automation", headers: { cookie: c }, payload });

const funil = async (c = cookie): Promise<Pipeline> => {
  const res = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie: c } });
  return res.json()[0];
};

const base = {
  autoCreateClient: false,
  autoCreateDeal: false,
  pipelineId: null,
  stageId: null,
  autoAssign: false,
  memberUserIds: [] as string[],
};

describe("GET /v1/lead-automation", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/lead-automation" });
    expect(res.statusCode).toBe(401);
  });

  it("nasce desligada — automação que nasce ligada mexeria no funil de quem não pediu", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.autoCreateClient).toBe(false);
    expect(body.autoCreateDeal).toBe(false);
    expect(body.autoAssign).toBe(false);
    expect(body.pipelineId).toBeNull();
  });

  it("traz os membros da organização com a carga de cada um", async () => {
    const { id: pipelineId, stages } = await funil();
    const cliente = await prisma.client.create({
      data: { organizationId: orgId, name: `Lead ${stamp}` },
    });
    await prisma.deal.create({
      data: {
        organizationId: orgId,
        clientId: cliente.id,
        pipelineId,
        stageId: stages[0]!.id,
        ownerId: userId,
        title: "aberto",
      },
    });

    const { members } = (await get()).json();
    const eu = members.find((m: { userId: string }) => m.userId === userId);
    expect(eu.openDeals).toBe(1);
    // ninguém participa da roleta até o gestor escolher
    expect(eu.active).toBe(false);
  });

  it("negócio ganho não conta como carga — o critério puniria quem vende", async () => {
    const { id: pipelineId } = await funil();
    const ganho = await prisma.stage.findFirstOrThrow({
      where: { pipelineId, isWon: true },
    });
    const cliente = await prisma.client.create({
      data: { organizationId: orgId, name: `Ganho ${stamp}` },
    });
    await prisma.deal.create({
      data: {
        organizationId: orgId,
        clientId: cliente.id,
        pipelineId,
        stageId: ganho.id,
        ownerId: userId,
        title: "ganho",
      },
    });

    const { members } = (await get()).json();
    const eu = members.find((m: { userId: string }) => m.userId === userId);
    expect(eu.openDeals).toBe(0);
  });
});

describe("PUT /v1/lead-automation", () => {
  it("grava as três chaves e quem participa da roleta", async () => {
    const { id: pipelineId, stages } = await funil();

    const res = await put({
      ...base,
      autoCreateClient: true,
      autoCreateDeal: true,
      pipelineId,
      stageId: stages[0]!.id,
      autoAssign: true,
      memberUserIds: [userId],
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.autoCreateDeal).toBe(true);
    expect(body.stageId).toBe(stages[0]!.id);
    expect(body.members.find((m: { userId: string }) => m.userId === userId).active).toBe(true);
  });

  it("recusa ligar a criação de negócio sem funil escolhido", async () => {
    const res = await put({ ...base, autoCreateDeal: true });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("AUTOMATION_TARGET_REQUIRED");
  });

  it("recusa estágio que não é do funil escolhido", async () => {
    const { id: pipelineId } = await funil();
    const outroFunil = await prisma.pipeline.create({
      data: { organizationId: orgId, name: `Outro ${stamp}`, position: 1 },
    });
    const outroEstagio = await prisma.stage.create({
      data: { organizationId: orgId, pipelineId: outroFunil.id, name: "Novo", position: 0 },
    });

    // par inconsistente criaria card órfão: o estágio existe, mas não neste funil
    const res = await put({ ...base, autoCreateDeal: true, pipelineId, stageId: outroEstagio.id });
    expect(res.statusCode).toBe(404);
  });

  it("recusa funil de outra imobiliária", async () => {
    const alheio = await funil(cookieB);

    const res = await put({
      ...base,
      autoCreateDeal: true,
      pipelineId: alheio.id,
      stageId: alheio.stages[0]!.id,
    });
    // o id existe, mas não nesta organização — o negócio nasceria no funil de outra imobiliária
    expect(res.statusCode).toBe(404);
  });

  it("recusa membro que não é desta imobiliária", async () => {
    const outroMembro = await prisma.member.findFirstOrThrow({
      where: { organizationId: orgIdB },
    });

    const res = await put({ ...base, autoAssign: true, memberUserIds: [outroMembro.userId] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("MEMBER_NOT_IN_ORG");
  });

  it("corretor não configura a automação — quem recebe lead é decisão de gestão", async () => {
    const corretor = await signUpWithOrg(app, `auto-c-${stamp}@eloscrm.test`, `auto-c-${stamp}`);
    const corretorUserId = (
      await prisma.member.findFirstOrThrow({ where: { organizationId: corretor.orgId } })
    ).userId;
    await prisma.member.create({
      data: { organizationId: orgId, userId: corretorUserId, role: "member" },
    });
    // trocar a org ativa pela API, não no banco: o Better Auth carrega a sessão do cookie, então
    // um update direto deixaria a request ainda apontando para a org onde ele é dono
    const ativado = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie: corretor.cookie },
      payload: { organizationId: orgId },
    });
    const comoCorretor = ativado.headers["set-cookie"]
      ? asCookie(ativado.headers["set-cookie"])
      : corretor.cookie;

    const res = await put({ ...base, autoCreateClient: true }, comoCorretor);
    expect(res.statusCode).toBe(403);
  });

  it("salvar de novo preserva o lastAssignedAt de quem continua na roleta", async () => {
    await put({ ...base, autoAssign: true, memberUserIds: [userId] });
    const marca = new Date("2026-08-01T10:00:00Z");
    // escopado: sem o where, a suíte em paralelo mexeria na roleta de outra organização
    await prisma.leadAutomationMember.updateMany({
      where: { automation: { organizationId: orgId }, userId },
      data: { lastAssignedAt: marca },
    });

    await put({ ...base, autoAssign: true, memberUserIds: [userId] });

    const membro = await prisma.leadAutomationMember.findFirstOrThrow({
      where: { automation: { organizationId: orgId }, userId },
    });
    // recriar as linhas a cada salvamento zeraria o desempate da roleta
    expect(membro.lastAssignedAt).toEqual(marca);
  });

  it("desmarcar um membro o tira da roleta sem apagar o histórico dele", async () => {
    await put({ ...base, autoAssign: true, memberUserIds: [userId] });
    await put({ ...base, autoAssign: true, memberUserIds: [] });

    const membro = await prisma.leadAutomationMember.findFirstOrThrow({
      where: { automation: { organizationId: orgId }, userId },
    });
    expect(membro.active).toBe(false);
  });

  it("grava UPDATED com o que mudou na configuração", async () => {
    const { id: pipelineId, stages } = await funil();

    // primeiro PUT parte do estado inicial (tudo desligado) para o mesmo estado — sem diff, sem evento
    await put(base);
    await put({
      ...base,
      autoCreateDeal: true,
      pipelineId,
      stageId: stages[0]!.id,
      autoAssign: true,
      memberUserIds: [userId],
    });

    const evento = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: "LEAD_AUTOMATION", action: "UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(evento.entityLabel).toBe("Automação de leads");
    expect(evento.changes).toMatchObject({
      autoCreateDeal: { from: false, to: true },
      autoAssign: { from: false, to: true },
      pipelineId: { from: null, to: pipelineId },
      stageId: { from: null, to: stages[0]!.id },
      memberUserIds: { from: [], to: [userId] },
    });
  });
});
