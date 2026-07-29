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

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `pa-audit-${stamp}@eloscrm.test`, `pa-audit-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de imóveis e atividades", () => {
  it("audita imóvel do cadastro à mudança de status", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/properties",
      headers: { cookie },
      payload: { title: "Casa auditada", status: "DISPONIVEL" },
    });
    const property = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/properties/${property.id}`,
      headers: { cookie },
      payload: { status: "RESERVADO" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.PROPERTY, entityId: property.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([AuditAction.CREATED, AuditAction.UPDATED]);
    expect(events[1].changes).toEqual({ status: { from: "DISPONIVEL", to: "RESERVADO" } });
  });

  it("audita atividade concluída", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/activities",
      headers: { cookie },
      payload: { type: "CALL", description: "Ligar para o cliente" },
    });
    const activity = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/activities/${activity.id}`,
      headers: { cookie },
      payload: { doneAt: "2026-07-29T12:00:00.000Z" },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.ACTIVITY, entityId: activity.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([AuditAction.CREATED, AuditAction.UPDATED]);
    expect(events[1].changes).toEqual({
      doneAt: { from: null, to: "2026-07-29T12:00:00.000Z" },
    });
  });
});
