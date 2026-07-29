import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { diffFields, recordAudit } from "../src/lib/audit.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `audit-lib-${stamp}@eloscrm.test`, `audit-lib-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("diffFields", () => {
  it("ignora campo ausente e campo igual", () => {
    const changes = diffFields({ name: "Ana", phone: "43999" }, { name: "Ana" });
    expect(changes).toEqual({});
  });

  it("registra de/para do que mudou", () => {
    const changes = diffFields({ name: "Ana", phone: "43999" }, { name: "Ana Paula", phone: null });
    expect(changes).toEqual({
      name: { from: "Ana", to: "Ana Paula" },
      phone: { from: "43999", to: null },
    });
  });

  it("compara Decimal do banco com number do payload sem falso positivo", () => {
    // Prisma.Decimal e o number do Zod precisam normalizar para a mesma forma
    const decimal = { toString: () => "500000" };
    expect(diffFields({ value: decimal }, { value: 500000 })).toEqual({});
    expect(diffFields({ value: decimal }, { value: 600000 })).toEqual({
      value: { from: "500000", to: "600000" },
    });
  });

  it("normaliza data para ISO e trata undefined como ausência", () => {
    const changes = diffFields(
      { dueAt: new Date("2026-01-01T12:00:00.000Z"), type: "CALL" },
      { dueAt: new Date("2026-02-02T12:00:00.000Z"), type: undefined },
    );
    expect(changes).toEqual({
      dueAt: { from: "2026-01-01T12:00:00.000Z", to: "2026-02-02T12:00:00.000Z" },
    });
  });
});

describe("recordAudit", () => {
  it("grava o evento com o ator", async () => {
    await recordAudit({
      orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "cliente-audit-lib",
      action: AuditAction.CREATED,
      actor: { id: "user-9", name: "Corretora Ana" },
    });

    const [event] = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityId: "cliente-audit-lib" },
    });
    expect(event.action).toBe(AuditAction.CREATED);
    expect(event.actorName).toBe("Corretora Ana");
    expect(event.changes).toBeNull();
  });

  it("não grava evento de update sem mudança nenhuma", async () => {
    await recordAudit({
      orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "cliente-sem-mudanca",
      action: AuditAction.UPDATED,
      actor: { id: "user-9", name: "Corretora Ana" },
      changes: {},
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityId: "cliente-sem-mudanca" },
    });
    expect(events).toHaveLength(0);
  });
});
