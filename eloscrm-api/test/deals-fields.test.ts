import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let userId = "";
let pipelineId = "";
let stageId = "";
let clientId = "";
let propertyId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `deals-f-${stamp}@eloscrm.test`, `deals-f-${stamp}`));

  const member = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId } });
  userId = member.userId;

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = pipelines.json()[0];
  pipelineId = pipeline.id;
  stageId = pipeline.stages[0].id;

  const client = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Cliente do negócio" },
  });
  clientId = client.json().id;

  const property = await app.inject({
    method: "POST",
    url: "/v1/properties",
    headers: { cookie },
    payload: { title: "Cobertura Gleba Palhano", price: 1200000 },
  });
  propertyId = property.json().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const createDeal = async (payload: Record<string, unknown>) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/deals",
    headers: { cookie },
    payload: { clientId, title: "Negócio", pipelineId, stageId, ...payload },
  });
  return res;
};

describe("campos do negócio", () => {
  it("cria com imóvel, responsável, valor e motivo da perda", async () => {
    const res = await createDeal({
      propertyId,
      ownerId: userId,
      value: 980000,
      lostReason: "Cliente achou caro",
    });

    expect(res.statusCode).toBe(201);
    const deal = res.json();
    expect(deal.propertyId).toBe(propertyId);
    expect(deal.ownerId).toBe(userId);
    expect(deal.value).toBe("980000");
    expect(deal.lostReason).toBe("Cliente achou caro");
  });

  // o formulário do web manda o mesmo payload em criar e editar, com null nos campos em branco:
  // se o POST recusasse null, criar negócio sem imóvel/responsável quebraria com 422
  it("aceita null nos opcionais já na criação", async () => {
    const res = await createDeal({ propertyId: null, ownerId: null, value: null, lostReason: null });

    expect(res.statusCode).toBe(201);
    const deal = res.json();
    expect(deal.propertyId).toBeNull();
    expect(deal.ownerId).toBeNull();
    expect(deal.value).toBeNull();
    expect(deal.lostReason).toBeNull();
  });

  it("limpa imóvel, responsável, valor e motivo da perda com null", async () => {
    const created = await createDeal({
      propertyId,
      ownerId: userId,
      value: 500000,
      lostReason: "Perdeu o financiamento",
    });
    const dealId = created.json().id;

    const cleared = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}`,
      headers: { cookie },
      payload: { propertyId: null, ownerId: null, value: null, lostReason: null },
    });

    expect(cleared.statusCode).toBe(200);
    const deal = cleared.json();
    expect(deal.propertyId).toBeNull();
    expect(deal.ownerId).toBeNull();
    expect(deal.value).toBeNull();
    expect(deal.lostReason).toBeNull();
  });

  it("recusa imóvel de outra organização (404)", async () => {
    const { cookie: cookieB } = await signUpWithOrg(
      app,
      `deals-f-b-${stamp}@eloscrm.test`,
      `deals-f-b-${stamp}`,
    );
    const otherProperty = await app.inject({
      method: "POST",
      url: "/v1/properties",
      headers: { cookie: cookieB },
      payload: { title: "Imóvel da org B" },
    });

    const res = await createDeal({ propertyId: otherProperty.json().id });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("audita a troca de responsável como OWNER_CHANGED e o resto como UPDATED", async () => {
    const created = await createDeal({ value: 300000 });
    const dealId = created.json().id;

    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}`,
      headers: { cookie },
      payload: { ownerId: userId },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}`,
      headers: { cookie },
      payload: { propertyId, lostReason: "Escolheu outro imóvel" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.DEAL, entityId: dealId },
      orderBy: { createdAt: "asc" },
    });

    const ownerEvent = events.find((event) => event.action === "OWNER_CHANGED");
    expect(ownerEvent).toBeTruthy();
    expect((ownerEvent!.changes as Record<string, { to: unknown }>).ownerId.to).toBe(userId);

    const updated = events.filter((event) => event.action === "UPDATED").at(-1);
    const changes = updated!.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.propertyId.to).toBe(propertyId);
    expect(changes.lostReason.to).toBe("Escolheu outro imóvel");
  });
});
