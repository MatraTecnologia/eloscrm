import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ClientStatus, NurtureReason } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let pipelineId = "";
let openStageId = "";
let lostStageId = "";

const createClient = async (name: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name },
  });
  return res.json() as { id: string; name: string };
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `nurture-${stamp}@eloscrm.test`, `nurture-${stamp}`));

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = pipelines.json()[0] as {
    id: string;
    stages: { id: string; isWon: boolean; isLost: boolean; position: number }[];
  };
  pipelineId = pipeline.id;
  openStageId = pipeline.stages.find((s) => !s.isWon && !s.isLost)!.id;
  lostStageId = pipeline.stages.find((s) => s.isLost)!.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("PATCH de cliente e o estado de nutrição", () => {
  it("reagenda a retomada e registra no histórico", async () => {
    const client = await createClient("Lead a reagendar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2026-09-01T23:59:59.999Z") },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: {
        nurtureUntil: "2026-11-30T23:59:59.999Z",
        nurtureReason: "ADIADO",
        nurtureNote: "Vai vender o apartamento antes",
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.nurtureUntil).toBe("2026-11-30T23:59:59.999Z");
    expect(updated.nurtureReason).toBe(NurtureReason.ADIADO);
    expect(updated.status).toBe(ClientStatus.NURTURING);

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
    });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].changes as object)).toContain("nurtureUntil");
  });

  // a invariante do módulo: se o PATCH pudesse mexer no status, existiria um caminho que muda o
  // estado do lead sem passar pela regra dos negócios abertos
  it("ignora status no PATCH", async () => {
    const client = await createClient("Lead que tentaria burlar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurturedAt: new Date() },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { status: "ACTIVE", nurturedAt: null, name: "Nome novo" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Nome novo");
    expect(res.json().status).toBe(ClientStatus.NURTURING);
    expect(res.json().nurturedAt).not.toBeNull();
  });

  it("limpa o motivo com null", async () => {
    const client = await createClient("Lead com motivo a limpar");
    await prisma.client.update({
      where: { id: client.id },
      data: {
        status: ClientStatus.NURTURING,
        nurtureReason: NurtureReason.OUTRO,
        nurtureNote: "x",
        nurtureUntil: new Date("2026-09-01T23:59:59.999Z"),
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { nurtureReason: null, nurtureNote: null, nurtureUntil: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nurtureReason).toBeNull();
    expect(res.json().nurtureNote).toBeNull();
    expect(res.json().nurtureUntil).toBeNull();
  });
});

describe("listagem de clientes por status", () => {
  let ativo = { id: "", name: "" };
  let nutridoVencido = { id: "", name: "" };
  let nutridoFuturo = { id: "", name: "" };
  let nutridoSemData = { id: "", name: "" };

  beforeAll(async () => {
    ativo = await createClient(`Ativo ${stamp}`);
    nutridoVencido = await createClient(`Vencido ${stamp}`);
    nutridoFuturo = await createClient(`Futuro ${stamp}`);
    nutridoSemData = await createClient(`Sem data ${stamp}`);

    await prisma.client.update({
      where: { id: nutridoVencido.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2020-01-01T00:00:00.000Z") },
    });
    await prisma.client.update({
      where: { id: nutridoFuturo.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2099-01-01T00:00:00.000Z") },
    });
    await prisma.client.update({
      where: { id: nutridoSemData.id },
      data: { status: ClientStatus.NURTURING },
    });
  });

  const list = async (query: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/clients${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { id: string }[]).map((c) => c.id);
  };

  it("sem filtro devolve só os ativos", async () => {
    const ids = await list("");
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(nutridoVencido.id);
    expect(ids).not.toContain(nutridoFuturo.id);
    expect(ids).not.toContain(nutridoSemData.id);
  });

  it("status=NURTURING devolve só os nutridos", async () => {
    const ids = await list("?status=NURTURING");
    expect(ids).not.toContain(ativo.id);
    expect(ids).toContain(nutridoVencido.id);
    expect(ids).toContain(nutridoFuturo.id);
    expect(ids).toContain(nutridoSemData.id);
  });

  it("status=ALL devolve os dois", async () => {
    const ids = await list("?status=ALL");
    expect(ids).toContain(ativo.id);
    expect(ids).toContain(nutridoFuturo.id);
  });

  it("overdue=true traz só os vencidos, e não os sem data", async () => {
    const ids = await list("?status=NURTURING&overdue=true");
    expect(ids).toContain(nutridoVencido.id);
    expect(ids).not.toContain(nutridoFuturo.id);
    expect(ids).not.toContain(nutridoSemData.id);
  });

  // "false" é string com valor booleano true em JS; z.coerce.boolean() aqui devolveria todo mundo
  // como vencido. O parse é explícito por causa disso.
  it("overdue=false não filtra nada", async () => {
    const ids = await list("?status=NURTURING&overdue=false");
    expect(ids).toContain(nutridoFuturo.id);
    expect(ids).toContain(nutridoSemData.id);
  });

  it("busca por nome continua funcionando junto do status", async () => {
    const ids = await list(`?status=NURTURING&q=Vencido ${stamp}`);
    expect(ids).toEqual([nutridoVencido.id]);
  });

  it("GET /clients/:id de lead nutrido continua 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${nutridoFuturo.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(ClientStatus.NURTURING);
  });
});

describe("POST /clients/:id/nurture", () => {
  it("bloqueia sem sessão (401)", async () => {
    const client = await createClient("Lead sem sessão");
    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      payload: { reason: "ADIADO" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("nutre com data e carimba nurturedAt no servidor", async () => {
    const client = await createClient("Lead a nutrir com data");
    const antes = Date.now();

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "SEM_ORCAMENTO",
        note: "Espera a taxa cair",
        until: "2026-12-31T23:59:59.999Z",
        // nurturedAt é do servidor: mandar aqui não pode ter efeito nenhum
        nurturedAt: "1999-01-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe(ClientStatus.NURTURING);
    expect(updated.nurtureReason).toBe(NurtureReason.SEM_ORCAMENTO);
    expect(updated.nurtureNote).toBe("Espera a taxa cair");
    expect(updated.nurtureUntil).toBe("2026-12-31T23:59:59.999Z");
    expect(new Date(updated.nurturedAt).getTime()).toBeGreaterThanOrEqual(antes);
  });

  it("nutre sem data (sem data definida é estado válido)", async () => {
    const client = await createClient("Lead a nutrir sem data");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "SEM_RESPOSTA" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nurtureUntil).toBeNull();
    expect(res.json().nurtureNote).toBeNull();
  });

  it("registra a transição no histórico", async () => {
    const client = await createClient("Lead auditado ao nutrir");
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "SO_PESQUISANDO" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
    });
    expect(events).toHaveLength(1);
    const changes = events[0].changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.status).toEqual({ from: "ACTIVE", to: "NURTURING" });
    expect(changes.nurtureReason.to).toBe("SO_PESQUISANDO");
  });

  it("recusa nutrir um lead já nutrido (409)", async () => {
    const client = await createClient("Lead nutrido duas vezes");
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ALREADY_NURTURING");
  });

  it("recusa motivo inválido (422)", async () => {
    const client = await createClient("Lead com motivo inválido");
    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "PORQUE_SIM" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("não nutre lead de outra organização (404)", async () => {
    const { cookie: cookieB } = await signUpWithOrg(
      app,
      `nurture-b-${stamp}@eloscrm.test`,
      `nurture-b-${stamp}`,
    );
    const client = await createClient("Lead da org A");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie: cookieB },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("nutrir com negócios abertos", () => {
  const createDeal = async (clientId: string, title: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId, title, pipelineId, stageId: openStageId },
    });
    return res.json() as { id: string };
  };

  it("fecha como perdido e herda a nota como motivo", async () => {
    const client = await createClient("Lead com negócio a fechar");
    const deal = await createDeal(client.id, "Apartamento centro");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "SEM_ORCAMENTO",
        note: "Não fecha em nada abaixo de 600k",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId }],
      },
    });

    expect(res.statusCode).toBe(200);
    const closed = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(closed.stageId).toBe(lostStageId);
    expect(closed.lostReason).toBe("Não fecha em nada abaixo de 600k");

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "DEAL", entityId: deal.id, action: "STAGE_CHANGED" },
    });
    expect(events).toHaveLength(1);
  });

  it("sem nota, o motivo do negócio vem do rótulo do reason", async () => {
    const client = await createClient("Lead sem nota");
    const deal = await createDeal(client.id, "Casa bairro alto");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "COMPROU_COM_OUTRO",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId }],
      },
    });

    const closed = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(closed.lostReason).toBe("Comprou com outro");
  });

  it("KEEP deixa o negócio onde está", async () => {
    const client = await createClient("Lead com negócio mantido");
    const deal = await createDeal(client.id, "Sala comercial");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: deal.id, action: "KEEP" }] },
    });

    expect(res.statusCode).toBe(200);
    const kept = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(kept.stageId).toBe(openStageId);
    expect(kept.lostReason).toBeNull();
  });

  // a UI tem que mostrar a consequência; deixar passar em silêncio esconderia o efeito colateral
  it("recusa quando um negócio aberto ficou de fora (422)", async () => {
    const client = await createClient("Lead com negócio esquecido");
    const deal = await createDeal(client.id, "Terreno beira-rio");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEALS_NOT_COVERED");

    const untouched = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(untouched.status).toBe(ClientStatus.ACTIVE);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId).toBe(openStageId);
  });

  it("recusa decisão sobre negócio que não é do lead (422)", async () => {
    const client = await createClient("Lead alvo");
    const outro = await createClient("Lead vizinho");
    const dealDoOutro = await createDeal(outro.id, "Negócio do vizinho");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: dealDoOutro.id, action: "KEEP" }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_OPEN");
  });

  it("recusa CLOSE_LOST sem lostStageId (422)", async () => {
    const client = await createClient("Lead sem estágio de perda");
    const deal = await createDeal(client.id, "Cobertura");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: deal.id, action: "CLOSE_LOST" }] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_LOST_STAGE");
  });

  it("recusa lostStageId que não é estágio de perda (422)", async () => {
    const client = await createClient("Lead com estágio errado");
    const deal = await createDeal(client.id, "Kitnet");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId: openStageId }],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_LOST_STAGE");
  });

  // o cenário que justifica a tarefa: validar tudo antes de escrever qualquer coisa. Sem este teste,
  // mover o fechamento para dentro do loop de validação "por conveniência" passaria despercebido.
  it("com dois negócios, falha na validação do segundo não fecha o primeiro (422)", async () => {
    const client = await createClient("Lead com dois negócios");
    const primeiro = await createDeal(client.id, "Apartamento válido");
    const segundo = await createDeal(client.id, "Casa com estágio errado");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        deals: [
          { dealId: primeiro.id, action: "CLOSE_LOST", lostStageId },
          { dealId: segundo.id, action: "CLOSE_LOST", lostStageId: openStageId },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_LOST_STAGE");

    const primeiroIntacto = await prisma.deal.findUniqueOrThrow({ where: { id: primeiro.id } });
    expect(primeiroIntacto.stageId).toBe(openStageId);
    expect(primeiroIntacto.lostReason).toBeNull();

    const leadIntacto = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(leadIntacto.status).toBe(ClientStatus.ACTIVE);
  });

  // o Map de cobertura colapsa duplicata, mas o loop de fechamento iterava a lista inteira: sem a
  // rejeição, o mesmo negócio seria movido duas vezes e o histórico ganharia dois STAGE_CHANGED
  it("recusa dealId duplicado na lista de decisões (422)", async () => {
    const client = await createClient("Lead com negócio duplicado na lista");
    const deal = await createDeal(client.id, "Cobertura duplicada");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        deals: [
          { dealId: deal.id, action: "KEEP" },
          { dealId: deal.id, action: "CLOSE_LOST", lostStageId },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DUPLICATE_DEAL");

    const dealIntacto = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(dealIntacto.stageId).toBe(openStageId);

    const leadIntacto = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(leadIntacto.status).toBe(ClientStatus.ACTIVE);
  });

  it("negócio já perdido não precisa de decisão", async () => {
    const client = await createClient("Lead com negócio já perdido");
    const deal = await createDeal(client.id, "Negócio antigo");
    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { stageId: lostStageId },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /clients/:id/reactivate", () => {
  const nutrirComNegocio = async (name: string, title: string) => {
    const client = await createClient(name);
    const dealRes = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title, pipelineId, stageId: openStageId },
    });
    const deal = dealRes.json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        until: "2026-12-31T23:59:59.999Z",
        deals: [{ dealId: deal.id, action: "CLOSE_LOST", lostStageId }],
      },
    });
    return { client, deal };
  };

  it("limpa os quatro campos e volta para ACTIVE", async () => {
    const { client } = await nutrirComNegocio("Lead a reativar", "Negócio a reabrir");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe(ClientStatus.ACTIVE);
    expect(updated.nurtureReason).toBeNull();
    expect(updated.nurtureNote).toBeNull();
    expect(updated.nurtureUntil).toBeNull();
    expect(updated.nurturedAt).toBeNull();
  });

  it("não reabre negócio nenhum por padrão", async () => {
    const { client, deal } = await nutrirComNegocio("Lead sem reabrir", "Negócio que fica perdido");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    const still = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(still.stageId).toBe(lostStageId);
  });

  it("reabre o negócio marcado no primeiro estágio aberto e limpa o motivo da perda", async () => {
    const { client, deal } = await nutrirComNegocio("Lead com reabertura", "Negócio reaberto");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [deal.id] },
    });

    expect(res.statusCode).toBe(200);
    const reopened = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(reopened.stageId).toBe(openStageId);
    expect(reopened.lostReason).toBeNull();

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "DEAL", entityId: deal.id, action: "STAGE_CHANGED" },
    });
    // um ao fechar na nutrição, outro ao reabrir
    expect(events).toHaveLength(2);
  });

  it("registra a reativação no histórico do lead", async () => {
    const { client } = await nutrirComNegocio("Lead auditado ao reativar", "Negócio qualquer");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
      orderBy: { createdAt: "asc" },
    });
    const last = events[events.length - 1].changes as Record<string, { from: unknown; to: unknown }>;
    expect(last.status).toEqual({ from: "NURTURING", to: "ACTIVE" });
  });

  it("recusa reativar lead que não está em nutrição (409)", async () => {
    const client = await createClient("Lead já ativo");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NOT_NURTURING");
  });

  it("recusa reabrir negócio que não está perdido (422)", async () => {
    const client = await createClient("Lead com negócio aberto reaberto");
    const dealRes = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio mantido", pipelineId, stageId: openStageId },
    });
    const deal = dealRes.json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", deals: [{ dealId: deal.id, action: "KEEP" }] },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [deal.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_LOST");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe(
      ClientStatus.NURTURING,
    );
  });

  it("recusa reabrir negócio de outro lead (422)", async () => {
    const { client } = await nutrirComNegocio("Lead alvo da reativação", "Negócio próprio");
    const { deal: dealAlheio } = await nutrirComNegocio("Lead vizinho nutrido", "Negócio alheio");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [dealAlheio.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_LOST");
  });

  // a mesma invariante da Task 5: validar tudo antes de escrever qualquer coisa. Os dois testes de
  // 422 acima usam um único reopenDealIds e nem chegam a começar o loop de escrita — este aqui prova
  // que um negócio válido no início da lista fica intacto quando um posterior falha na validação.
  it("com dois negócios marcados, falha na validação do segundo não reabre o primeiro (422)", async () => {
    const client = await createClient("Lead com dois negócios perdidos");
    const dealRes1 = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio perdido válido", pipelineId, stageId: openStageId },
    });
    const primeiro = dealRes1.json() as { id: string };
    const dealRes2 = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio perdido também", pipelineId, stageId: openStageId },
    });
    const segundo = dealRes2.json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        deals: [
          { dealId: primeiro.id, action: "CLOSE_LOST", lostStageId },
          { dealId: segundo.id, action: "CLOSE_LOST", lostStageId },
        ],
      },
    });

    const outro = await createClient("Lead vizinho com negócio alheio aberto");
    const dealResAlheio = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: outro.id, title: "Negócio alheio aberto", pipelineId, stageId: openStageId },
    });
    const alheio = dealResAlheio.json() as { id: string };

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [primeiro.id, alheio.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DEAL_NOT_LOST");

    const primeiroIntacto = await prisma.deal.findUniqueOrThrow({ where: { id: primeiro.id } });
    expect(primeiroIntacto.stageId).toBe(lostStageId);

    const leadIntacto = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(leadIntacto.status).toBe(ClientStatus.NURTURING);
  });

  it("recusa reabrir quando o pipeline do negócio não tem estágio aberto (422)", async () => {
    const pipelineRes = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: {
        name: `Pipeline sem estágio aberto ${stamp}`,
        stages: [
          { name: "Ganho", isWon: true },
          { name: "Perdido", isLost: true },
        ],
      },
    });
    const semAberto = pipelineRes.json() as {
      id: string;
      stages: { id: string; isLost: boolean }[];
    };
    const semAbertoLostStageId = semAberto.stages.find((s) => s.isLost)!.id;

    const client = await createClient("Lead em pipeline sem estágio aberto");
    const dealRes = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: {
        clientId: client.id,
        title: "Negócio sem estágio aberto para voltar",
        pipelineId: semAberto.id,
        stageId: semAbertoLostStageId,
      },
    });
    const deal = dealRes.json() as { id: string };

    // o negócio já nasce perdido (fora do filtro de "aberto"), então nutrir sem decisão sobre ele é válido
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie },
      payload: { reopenDealIds: [deal.id] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NO_OPEN_STAGE");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe(
      ClientStatus.NURTURING,
    );
  });

  it("não reativa lead de outra organização (404)", async () => {
    const { cookie: cookieC } = await signUpWithOrg(
      app,
      `nurture-c-${stamp}@eloscrm.test`,
      `nurture-c-${stamp}`,
    );
    const { client } = await nutrirComNegocio("Lead protegido", "Negócio protegido");

    const res = await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/reactivate`,
      headers: { cookie: cookieC },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });
});
