import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";
let orgId = "";
let orgIdB = "";

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
  ({ cookie, orgId } = await signUpWithOrg(app, `pipelines-a-${stamp}@eloscrm.test`, `pipelines-a-${stamp}`));
  ({ cookie: cookieB, orgId: orgIdB } = await signUpWithOrg(
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

describe("GET /v1/pipelines/:id/deletion-preview", () => {
  it("diz que pode excluir quando o funil está vazio e não é o único", async () => {
    await app.inject({ method: "POST", url: "/v1/pipelines", headers: { cookie }, payload: { name: "Outro Qualquer" } });
    const criado = (
      await app.inject({
        method: "POST",
        url: "/v1/pipelines",
        headers: { cookie },
        payload: { name: "Funil Vazio", stages: [{ name: "Entrada" }, { name: "Saída" }] },
      })
    ).json();

    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${criado.id}/deletion-preview`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      pipeline: { name: "Funil Vazio" },
      stages: ["Entrada", "Saída"],
      deals: { total: 0, open: 0, closed: 0 },
      canDelete: true,
      blockers: [],
    });
  });

  it("lista os negócios por estágio quando eles impedem a exclusão", async () => {
    const criado = (
      await app.inject({
        method: "POST",
        url: "/v1/pipelines",
        headers: { cookie },
        payload: {
          name: "Funil Com Negócio",
          stages: [{ name: "Contato" }, { name: "Proposta" }, { name: "Perdido", isLost: true }],
        },
      })
    ).json();
    const [contato, proposta, perdido] = criado.stages;
    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead Do Funil" },
    });
    for (const stage of [contato, contato, proposta, perdido]) {
      await prisma.deal.create({
        data: {
          organizationId: orgId,
          clientId: client.id,
          title: `Negócio em ${stage.name}`,
          pipelineId: criado.id,
          stageId: stage.id,
        },
      });
    }

    const body = (
      await app.inject({
        method: "GET",
        url: `/v1/pipelines/${criado.id}/deletion-preview`,
        headers: { cookie },
      })
    ).json();

    expect(body.canDelete).toBe(false);
    // aberto e fechado separados: o gestor decide diferente para cada um
    expect(body.deals).toEqual({ total: 4, open: 3, closed: 1 });
    // na ordem do kanban, e só os estágios que têm negócio
    expect(body.dealsByStage).toEqual([
      { stage: "Contato", count: 2 },
      { stage: "Proposta", count: 1 },
      { stage: "Perdido", count: 1 },
    ]);
    expect(body.blockers.map((b: { code: string }) => b.code)).toEqual(["PIPELINE_HAS_DEALS"]);
  });

  it("não vaza prévia de funil de outra imobiliária (404)", async () => {
    const criado = (
      await app.inject({ method: "POST", url: "/v1/pipelines", headers: { cookie }, payload: { name: "Meu Funil" } })
    ).json();
    const res = await app.inject({
      method: "GET",
      url: `/v1/pipelines/${criado.id}/deletion-preview`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("auditoria de pipelines e estágios", () => {
  it("audita criação de pipeline", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Auditado" },
    });
    const pipeline = created.json();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.CREATED },
    });
    expect(event.entityLabel).toBe("Pipeline Auditado");
    // os nomes das colunas, na ordem: sem template escolhido, o funil nasce com os genéricos
    expect(event.context).toEqual({ stages: ["Novo", "Ganho", "Perdido"] });
    expect(event.actorName).toBeTruthy();
  });

  it("registra as colunas do template escolhido na criação", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: {
        name: "Locação Auditada",
        stages: [
          { name: "Interessado" },
          { name: "Visita" },
          { name: "Contrato" },
          { name: "Ativo", isWon: true },
          { name: "Recusado", isLost: true },
        ],
      },
    });
    const pipeline = created.json();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.CREATED },
    });
    // é o que identifica o template no log: o id dele não chega à API, só os estágios
    expect(event.context).toEqual({
      stages: ["Interessado", "Visita", "Contrato", "Ativo", "Recusado"],
    });
  });

  it("a exclusão guarda as colunas que foram com o funil", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Funil Que Some", stages: [{ name: "Entrada" }, { name: "Saída" }] },
    });
    const pipeline = created.json();

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/pipelines/${pipeline.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.DELETED },
    });
    // os estágios cascateiam com o funil; se o evento não os guardasse, ninguém mais saberia quais eram
    expect(event.context).toEqual({ stages: ["Entrada", "Saída"] });
  });

  it("audita atualização de pipeline", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Original" },
    });
    const pipeline = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${pipeline.id}`,
      headers: { cookie },
      payload: { name: "Pipeline Renomeado" },
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.UPDATED },
    });
    expect(event.entityLabel).toBe("Pipeline Renomeado");
    expect(event.changes).toEqual({ name: { from: "Pipeline Original", to: "Pipeline Renomeado" } });
  });

  it("audita remoção de pipeline e o rótulo sobrevive à exclusão", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Para Apagar" },
    });
    const pipeline = created.json();

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/pipelines/${pipeline.id}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);
    expect(await prisma.pipeline.findUnique({ where: { id: pipeline.id } })).toBeNull();

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.DELETED },
    });
    expect(event.entityLabel).toBe("Pipeline Para Apagar");
  });

  it("audita criação, atualização e remoção de estágio com o nome do pipeline no contexto", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Dos Estágios" },
    });
    const pipeline = created.json();

    const addStage = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${pipeline.id}/stages`,
      headers: { cookie },
      payload: { name: "Estágio Novo" },
    });
    const stage = addStage.json();

    const createdEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.STAGE, entityId: stage.id, action: AuditAction.CREATED },
    });
    expect(createdEvent.entityLabel).toBe("Estágio Novo");
    expect(createdEvent.context).toEqual({ pipelineName: "Pipeline Dos Estágios" });

    await app.inject({
      method: "PATCH",
      url: `/v1/stages/${stage.id}`,
      headers: { cookie },
      payload: { name: "Estágio Renomeado" },
    });

    const updatedEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.STAGE, entityId: stage.id, action: AuditAction.UPDATED },
    });
    expect(updatedEvent.entityLabel).toBe("Estágio Renomeado");
    expect(updatedEvent.changes).toEqual({ name: { from: "Estágio Novo", to: "Estágio Renomeado" } });
    expect(updatedEvent.context).toEqual({ pipelineName: "Pipeline Dos Estágios" });

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/stages/${stage.id}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);
    expect(await prisma.stage.findUnique({ where: { id: stage.id } })).toBeNull();

    const deletedEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.STAGE, entityId: stage.id, action: AuditAction.DELETED },
    });
    expect(deletedEvent.entityLabel).toBe("Estágio Renomeado");
    expect(deletedEvent.context).toEqual({ pipelineName: "Pipeline Dos Estágios" });
  });

  it("audita reordenação de estágios com nomes, não ids", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie },
      payload: { name: "Pipeline Para Reordenar" },
    });
    const pipeline = created.json();
    const stages = pipeline.stages as Stage[];
    const originalNames = stages.map((s) => s.name);
    const reversedIds = [...stages].reverse().map((s) => s.id);
    const reversedNames = [...originalNames].reverse();

    const reordered = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${pipeline.id}/reorder-stages`,
      headers: { cookie },
      payload: { stageIds: reversedIds },
    });
    expect(reordered.statusCode).toBe(200);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.REORDERED },
    });
    expect(event.changes).toEqual({ order: { from: originalNames, to: reversedNames } });

    // depois de um estágio ser apagado, o evento de reorder continua legível — não depende do id
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/stages/${reversedIds[0]}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);
    const stillThere = await prisma.auditEvent.findFirstOrThrow({ where: { id: event.id } });
    expect(stillThere.changes).toEqual({ order: { from: originalNames, to: reversedNames } });
  });

  it("isola eventos de auditoria de pipeline por organização", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/pipelines",
      headers: { cookie: cookieB },
      payload: { name: "Pipeline Da Org B" },
    });
    const pipeline = created.json();

    const eventInB = await prisma.auditEvent.findFirst({
      where: { organizationId: orgIdB, entityType: AuditEntity.PIPELINE, entityId: pipeline.id, action: AuditAction.CREATED },
    });
    expect(eventInB).not.toBeNull();

    const eventInA = await prisma.auditEvent.findFirst({
      where: { organizationId: orgId, entityType: AuditEntity.PIPELINE, entityId: pipeline.id },
    });
    expect(eventInA).toBeNull();
  });
});
