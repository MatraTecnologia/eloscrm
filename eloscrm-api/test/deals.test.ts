import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieB = "";
let pipelineId = "";
let stageId = "";
let otherStageId = "";
let pipelineBId = "";
let stageBId = "";

type Stage = { id: string };
type Pipeline = { id: string; stages: Stage[] };

const getDefaultPipeline = async (headers: { cookie: string }): Promise<Pipeline> => {
  const res = await app.inject({ method: "GET", url: "/v1/pipelines", headers });
  return (res.json() as Pipeline[])[0];
};

const createClient = async (headers: { cookie: string }, name: string) => {
  const res = await app.inject({ method: "POST", url: "/v1/clients", headers, payload: { name } });
  return res.json();
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `deals-a-${stamp}@eloscrm.test`, `deals-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `deals-b-${stamp}@eloscrm.test`, `deals-b-${stamp}`));

  const pipeline = await getDefaultPipeline({ cookie });
  pipelineId = pipeline.id;
  stageId = pipeline.stages[0].id;
  otherStageId = pipeline.stages[1].id;

  const pipelineB = await getDefaultPipeline({ cookie: cookieB });
  pipelineBId = pipelineB.id;
  stageBId = pipelineB.stages[0].id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("deals", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/deals" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("valida corpo inválido no POST (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { title: "Sem cliente" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("cria, lista, busca, filtra, move de estágio e remove um negócio", async () => {
    const client = await createClient({ cookie }, "Carlos Silva");

    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Apartamento Centro", pipelineId, stageId, value: 350000 },
    });
    expect(created.statusCode).toBe(201);
    const deal = created.json();
    expect(deal.id).toBeTruthy();
    expect(deal.organizationId).toBe(orgId);
    expect(deal.stageId).toBe(stageId);

    const list = await app.inject({ method: "GET", url: "/v1/deals", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((d: { id: string }) => d.id === deal.id)).toBe(true);

    const byId = await app.inject({ method: "GET", url: `/v1/deals/${deal.id}`, headers: { cookie } });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().title).toBe("Apartamento Centro");

    const filtered = await app.inject({
      method: "GET",
      url: `/v1/deals?stageId=${stageId}`,
      headers: { cookie },
    });
    expect(filtered.json().some((d: { id: string }) => d.id === deal.id)).toBe(true);

    const moved = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { stageId: otherStageId },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().stageId).toBe(otherStageId);

    const removed = await app.inject({ method: "DELETE", url: `/v1/deals/${deal.id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({ method: "GET", url: `/v1/deals/${deal.id}`, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("NOT_FOUND");
  });

  it("não vaza negócio entre organizações (cross-tenant → 404)", async () => {
    const client = await createClient({ cookie }, "Lead Privado A");
    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio Privado A", pipelineId, stageId },
    });
    const dealA = created.json();

    const byB = await app.inject({ method: "GET", url: `/v1/deals/${dealA.id}`, headers: { cookie: cookieB } });
    expect(byB.statusCode).toBe(404);

    const listB = await app.inject({ method: "GET", url: "/v1/deals", headers: { cookie: cookieB } });
    expect(listB.json().some((d: { id: string }) => d.id === dealA.id)).toBe(false);
  });

  it("bloqueia criação de negócio com stageId de outra organização (cross-tenant → 404)", async () => {
    const clientB = await createClient({ cookie: cookieB }, "Cliente Org B");

    const res = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie: cookieB },
      payload: { clientId: clientB.id, title: "Negócio inválido", pipelineId, stageId },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("bloqueia mover negócio pra estágio de outro pipeline/organização (404)", async () => {
    const client = await createClient({ cookie }, "Cliente Mover Estágio");
    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio Mover", pipelineId, stageId },
    });
    const deal = created.json();

    const movedToOtherOrg = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { stageId: stageBId },
    });
    expect(movedToOtherOrg.statusCode).toBe(404);
    expect(movedToOtherOrg.json().error.code).toBe("NOT_FOUND");
  });

  describe("transferência entre funis", () => {
    let outroPipelineId = "";
    let outroStageId = "";

    const criarNegocio = async (title: string) => {
      const client = await createClient({ cookie }, `Cliente ${title}`);
      const res = await app.inject({
        method: "POST",
        url: "/v1/deals",
        headers: { cookie },
        payload: { clientId: client.id, title, pipelineId, stageId },
      });
      return res.json();
    };

    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/pipelines",
        headers: { cookie },
        payload: { name: `Locação ${stamp}`, stages: [{ name: "Visita" }, { name: "Contrato" }] },
      });
      const pipeline = res.json() as Pipeline;
      outroPipelineId = pipeline.id;
      outroStageId = pipeline.stages[0].id;
    });

    it("transfere para outro funil e registra funil e estágio no histórico", async () => {
      const deal = await criarNegocio("Negócio Transferido");

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/deals/${deal.id}`,
        headers: { cookie },
        payload: { pipelineId: outroPipelineId, stageId: outroStageId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ pipelineId: outroPipelineId, stageId: outroStageId });

      const audit = await app.inject({
        method: "GET",
        url: `/v1/audit-events?entityType=DEAL&entityId=${deal.id}`,
        headers: { cookie },
      });
      const evento = (audit.json() as { action: string; changes: Record<string, unknown> }[]).find(
        (e) => e.action === "STAGE_CHANGED",
      );
      // o histórico guarda nome, não id: "Funil de Vendas → Locação" é o que o corretor lê
      expect(evento?.changes).toMatchObject({
        pipeline: { from: expect.any(String), to: `Locação ${stamp}` },
        stage: { from: expect.any(String), to: "Visita" },
      });
    });

    it("recusa trocar de funil sem dizer o estágio de destino (422)", async () => {
      const deal = await criarNegocio("Negócio Sem Estágio");

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/deals/${deal.id}`,
        headers: { cookie },
        payload: { pipelineId: outroPipelineId },
      });
      expect(res.statusCode).toBe(422);

      // e o negócio continua inteiro no funil de origem, não meio no destino
      const depois = await app.inject({
        method: "GET",
        url: `/v1/deals/${deal.id}`,
        headers: { cookie },
      });
      expect(depois.json()).toMatchObject({ pipelineId, stageId });
    });

    it("transfere vários de uma vez, de estágios de origem diferentes", async () => {
      const primeiro = await criarNegocio("Lote A")
      const segundo = await criarNegocio("Lote B")
      // origens distintas: é o que prova que o histórico de cada um guarda o próprio estágio
      await app.inject({
        method: "PATCH",
        url: `/v1/deals/${segundo.id}`,
        headers: { cookie },
        payload: { stageId: otherStageId },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/deals/bulk-transfer",
        headers: { cookie },
        payload: {
          dealIds: [primeiro.id, segundo.id, primeiro.id],
          pipelineId: outroPipelineId,
          stageId: outroStageId,
        },
      });
      expect(res.statusCode).toBe(200);
      // o id repetido não conta duas vezes
      expect(res.json()).toEqual({ transferred: 2 });

      for (const deal of [primeiro, segundo]) {
        const depois = await app.inject({
          method: "GET",
          url: `/v1/deals/${deal.id}`,
          headers: { cookie },
        });
        expect(depois.json()).toMatchObject({
          pipelineId: outroPipelineId,
          stageId: outroStageId,
        });
      }

      const audit = await app.inject({
        method: "GET",
        url: `/v1/audit-events?entityType=DEAL&entityId=${segundo.id}`,
        headers: { cookie },
      });
      // o lote tem ação própria (TRANSFERRED): no log geral ela separa a transferência em massa do
      // arrasto de um cartão no kanban
      const evento = (audit.json() as { action: string; changes: Record<string, unknown> }[]).find(
        (e) => e.action === "TRANSFERRED" && "pipeline" in (e.changes ?? {}),
      );
      // o segundo saiu do segundo estágio, não do primeiro: o lote não pode carimbar a mesma origem
      // em todo mundo
      expect(evento?.changes).toMatchObject({ stage: { from: "Contato", to: "Visita" } });
    });

    it("não transfere nada se um dos negócios é de outra imobiliária (404)", async () => {
      const meu = await criarNegocio("Lote Meu");
      const clienteB = await createClient({ cookie: cookieB }, "Cliente B Lote");
      const alheio = await app.inject({
        method: "POST",
        url: "/v1/deals",
        headers: { cookie: cookieB },
        payload: {
          clientId: clienteB.id,
          title: "Negócio de outra org",
          pipelineId: pipelineBId,
          stageId: stageBId,
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/deals/bulk-transfer",
        headers: { cookie },
        payload: {
          dealIds: [meu.id, alheio.json().id],
          pipelineId: outroPipelineId,
          stageId: outroStageId,
        },
      });
      expect(res.statusCode).toBe(404);

      // e o meu continua onde estava: o lote é tudo ou nada
      const depois = await app.inject({
        method: "GET",
        url: `/v1/deals/${meu.id}`,
        headers: { cookie },
      });
      expect(depois.json()).toMatchObject({ pipelineId, stageId });
    });

    it("recusa estágio que não é do funil de destino (404)", async () => {
      const deal = await criarNegocio("Negócio Estágio Errado");

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/deals/${deal.id}`,
        headers: { cookie },
        // estágio do funil de origem, funil de destino: a combinação que deixaria o negócio
        // apontando para um estágio que não existe no funil dele
        payload: { pipelineId: outroPipelineId, stageId: otherStageId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    });
  });
});
