import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let clientId = "";
let pipelineId = "";
let stages: { id: string; name: string }[] = [];

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `deal-audit-${stamp}@eloscrm.test`, `deal-audit-${stamp}`));

  const client = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Cliente do Funil" },
  });
  clientId = client.json().id;

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const [pipeline] = pipelines.json();
  pipelineId = pipeline.id;
  stages = pipeline.stages;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de negociações", () => {
  it("registra a mudança de estágio com os nomes de origem e destino", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: {
        clientId,
        pipelineId,
        stageId: stages[0].id,
        title: "Negociação auditada",
        value: 500000,
      },
    });
    const deal = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { stageId: stages[1].id },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.DEAL, entityId: deal.id },
      orderBy: { createdAt: "asc" },
    });

    expect(events.map((e) => e.action)).toEqual([AuditAction.CREATED, AuditAction.STAGE_CHANGED]);
    expect(events[1].changes).toEqual({
      stage: { from: stages[0].name, to: stages[1].name },
    });
  });

  it("marca troca de responsável como OWNER_CHANGED", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/deals",
      headers: { cookie },
      payload: { clientId, pipelineId, stageId: stages[0].id, title: "Troca de dono" },
    });
    const deal = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${deal.id}`,
      headers: { cookie },
      payload: { ownerId: "outro-corretor" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.DEAL, entityId: deal.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events[1].action).toBe(AuditAction.OWNER_CHANGED);
    expect(events[1].changes).toEqual({ ownerId: { from: null, to: "outro-corretor" } });
  });
});
