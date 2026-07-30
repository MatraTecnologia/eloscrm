import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";
let pipelineId = "";
let stages: { id: string; name: string }[] = [];

type Pipeline = { id: string; stages: { id: string; name: string }[] };

const createClient = async (headers: { cookie: string }, name: string, source?: string) => {
  const res = await app.inject({ method: "POST", url: "/v1/clients", headers, payload: { name, source } });
  return res.json();
};

const createDeal = async (
  headers: { cookie: string },
  clientId: string,
  title: string,
  stageId: string,
  value?: number,
) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/deals",
    headers,
    payload: { clientId, title, pipelineId, stageId, value },
  });
  return res.json();
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `dashboard-a-${stamp}@eloscrm.test`, `dashboard-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(
    app,
    `dashboard-b-${stamp}@eloscrm.test`,
    `dashboard-b-${stamp}`,
  ));

  const pipelinesRes = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = (pipelinesRes.json() as Pipeline[])[0];
  pipelineId = pipeline.id;
  stages = pipeline.stages;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("dashboard", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/dashboard/stats" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("agrega kpis, funil e origem coerentes com os dados da organização", async () => {
    const clientA = await createClient({ cookie }, "Carlos Silva", "SITE");
    const clientB = await createClient({ cookie }, "Maria Souza", "INSTAGRAM");
    const clientC = await createClient({ cookie }, "João Pereira", "INDICACAO");

    const [novoLead, , , , proposta, fechado, perdido] = stages;

    await createDeal({ cookie }, clientA.id, "Apartamento Centro", novoLead.id, 200000);
    await createDeal({ cookie }, clientB.id, "Casa Jardim", proposta.id, 350000);
    await createDeal({ cookie }, clientC.id, "Sala Comercial", fechado.id, 150000);
    await createDeal({ cookie }, clientC.id, "Terreno Rural", perdido.id, 80000);

    const res = await app.inject({ method: "GET", url: "/v1/dashboard/stats", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const stats = res.json();

    expect(stats.kpis.totalClients).toBe(3);
    expect(stats.kpis.totalDeals).toBe(4);
    expect(stats.kpis.openDeals).toBe(2);
    expect(stats.kpis.wonDeals).toBe(1);
    expect(stats.kpis.openValue).toBe(550000);

    const funnel = stats.funnel as { name: string; total: number }[];
    expect(funnel.length).toBe(7);
    const funnelSum = funnel.reduce((sum, entry) => sum + entry.total, 0);
    expect(funnelSum).toBe(stats.kpis.totalDeals);
    expect(funnel.find((entry) => entry.name === novoLead.name)?.total).toBe(1);
    expect(funnel.find((entry) => entry.name === proposta.name)?.total).toBe(1);
    expect(funnel.find((entry) => entry.name === fechado.name)?.total).toBe(1);
    expect(funnel.find((entry) => entry.name === perdido.name)?.total).toBe(1);

    const sourceSum = (Object.values(stats.bySource) as number[]).reduce((a, b) => a + b, 0);
    expect(sourceSum).toBe(stats.kpis.totalClients);
    expect(stats.bySource.SITE).toBe(1);
    expect(stats.bySource.INSTAGRAM).toBe(1);
    expect(stats.bySource.INDICACAO).toBe(1);
    expect(stats.bySource.OUTROS).toBe(0);
  });

  it("não vaza dados entre organizações (cross-tenant)", async () => {
    const resB = await app.inject({ method: "GET", url: "/v1/dashboard/stats", headers: { cookie: cookieB } });
    expect(resB.statusCode).toBe(200);
    const statsB = resB.json();

    expect(statsB.kpis.totalClients).toBe(0);
    expect(statsB.kpis.totalDeals).toBe(0);
    expect(statsB.kpis.openValue).toBe(0);
  });

  it("tira o lead nutrido do total e o conta nos KPIs de nutrição", async () => {
    const { cookie: cookieN } = await signUpWithOrg(
      app,
      `dash-n-${stamp}@eloscrm.test`,
      `dash-n-${stamp}`,
    );
    await createClient({ cookie: cookieN }, "Ativo do painel", "SITE");
    const vencido = await createClient({ cookie: cookieN }, "Vencido do painel", "SITE");
    const futuro = await createClient({ cookie: cookieN }, "Futuro do painel", "INSTAGRAM");

    await app.inject({
      method: "POST",
      url: `/v1/clients/${vencido.id}/nurture`,
      headers: { cookie: cookieN },
      payload: { reason: "ADIADO", until: "2020-01-01T00:00:00.000Z" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/clients/${futuro.id}/nurture`,
      headers: { cookie: cookieN },
      payload: { reason: "ADIADO", until: "2099-01-01T00:00:00.000Z" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/dashboard/stats",
      headers: { cookie: cookieN },
    });
    const stats = res.json();

    expect(stats.kpis.totalClients).toBe(1);
    expect(stats.kpis.nurturing).toBe(2);
    expect(stats.kpis.nurtureDue).toBe(1);
    // bySource acompanha totalClients: contar bases diferentes quebraria o painel em silêncio
    expect(stats.bySource.SITE).toBe(1);
    expect(stats.bySource.INSTAGRAM).toBe(0);
    const sourceSum = (Object.values(stats.bySource) as number[]).reduce((a, b) => a + b, 0);
    expect(sourceSum).toBe(stats.kpis.totalClients);
  });
});
