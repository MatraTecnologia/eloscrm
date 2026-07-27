import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";

type Stage = { id: string; name: string; pipelineId: string };
type Pipeline = { id: string; name: string; stages: Stage[] };

const getPipelines = async (headers: { cookie: string }): Promise<Pipeline[]> => {
  const res = await app.inject({ method: "GET", url: "/v1/pipelines", headers });
  return res.json();
};

const createClient = async (headers: { cookie: string }, name: string) => {
  const res = await app.inject({ method: "POST", url: "/v1/clients", headers, payload: { name } });
  return res.json();
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `pipelines-a-${stamp}@eloscrm.test`, `pipelines-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(
    app,
    `pipelines-b-${stamp}@eloscrm.test`,
    `pipelines-b-${stamp}`,
  ));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("pipelines", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/pipelines" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("cria e retorna o pipeline default com 7 estágios", async () => {
    const pipelines = await getPipelines({ cookie });
    expect(pipelines.length).toBe(1);
    expect(pipelines[0].name).toBe("Funil de Vendas");
    expect(pipelines[0].stages.length).toBe(7);
    expect(pipelines[0].stages[0].name).toBe("Novo lead");

    // idempotente: uma segunda chamada não deve criar outro default
    const again = await getPipelines({ cookie });
    expect(again.length).toBe(1);
  });

  it("cria um pipeline novo já com 3 estágios genéricos", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Locação" },
    });
    expect(res.statusCode).toBe(201);
    const pipeline = res.json();
    expect(pipeline.stages.length).toBe(3);
    expect(pipeline.stages.map((s: Stage) => s.name)).toEqual(["Novo", "Ganho", "Perdido"]);
  });

  it("adiciona, renomeia e reordena estágios de um pipeline", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Reorder" },
    });
    const pipeline = created.json();

    const addStage = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${pipeline.id}/stages`,
      headers: { cookie },
      payload: { name: "Extra" },
    });
    expect(addStage.statusCode).toBe(201);
    const newStage = addStage.json();
    expect(newStage.position).toBe(3);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/v1/stages/${newStage.id}`,
      headers: { cookie },
      payload: { name: "Extra Renomeado" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("Extra Renomeado");

    const stageIds = pipeline.stages.map((s: Stage) => s.id).reverse();
    stageIds.unshift(newStage.id);
    const reordered = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${pipeline.id}/reorder-stages`,
      headers: { cookie },
      payload: { stageIds },
    });
    expect(reordered.statusCode).toBe(200);
    const orderedStages = reordered.json().stages as Stage[];
    expect(orderedStages.map((s) => s.id)).toEqual(stageIds);
  });

  it("bloqueia remoção de estágio com negócios (409 STAGE_HAS_DEALS)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Delete Stage" },
    });
    const pipeline = created.json();
    const [firstStage] = pipeline.stages as Stage[];

    const client = await createClient({ cookie }, "Cliente Delete Stage");
    const deal = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId: client.id, title: "Negócio", pipelineId: pipeline.id, stageId: firstStage.id },
    });
    expect(deal.statusCode).toBe(201);

    const blockedByDeals = await app.inject({
      method: "DELETE",
      url: `/v1/stages/${firstStage.id}`,
      headers: { cookie },
    });
    expect(blockedByDeals.statusCode).toBe(409);
    expect(blockedByDeals.json().error.code).toBe("STAGE_HAS_DEALS");
  });

  it("bloqueia remoção do último estágio do pipeline (409 LAST_STAGE)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Last Stage" },
    });
    const pipeline = created.json();
    const [firstStage, secondStage, thirdStage] = pipeline.stages as Stage[];

    const removedFirst = await app.inject({
      method: "DELETE",
      url: `/v1/stages/${firstStage.id}`,
      headers: { cookie },
    });
    expect(removedFirst.statusCode).toBe(204);

    const removedSecond = await app.inject({
      method: "DELETE",
      url: `/v1/stages/${secondStage.id}`,
      headers: { cookie },
    });
    expect(removedSecond.statusCode).toBe(204);

    const blockedLast = await app.inject({
      method: "DELETE",
      url: `/v1/stages/${thirdStage.id}`,
      headers: { cookie },
    });
    expect(blockedLast.statusCode).toBe(409);
    expect(blockedLast.json().error.code).toBe("LAST_STAGE");
  });

  it("não vaza estágio entre organizações (cross-tenant → 404)", async () => {
    const pipelinesA = await getPipelines({ cookie });
    const stageA = pipelinesA[0].stages[0];

    const patchByB = await app.inject({
      method: "PATCH",
      url: `/v1/stages/${stageA.id}`,
      headers: { cookie: cookieB },
      payload: { name: "Invadido" },
    });
    expect(patchByB.statusCode).toBe(404);
    expect(patchByB.json().error.code).toBe("NOT_FOUND");
  });
});
