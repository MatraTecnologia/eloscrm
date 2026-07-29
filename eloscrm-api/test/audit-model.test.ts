import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `audit-model-${stamp}@eloscrm.test`, `audit-model-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo AuditEvent", () => {
  it("grava evento com changes em JSON e filtra por entidade", async () => {
    await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: "cliente-1",
        action: AuditAction.UPDATED,
        actorId: "user-1",
        actorName: "Corretor Teste",
        changes: { name: { from: "Antes", to: "Depois" } },
      },
    });

    const found = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: "cliente-1" },
    });

    expect(found).toHaveLength(1);
    expect(found[0].actorName).toBe("Corretor Teste");
    expect(found[0].changes).toEqual({ name: { from: "Antes", to: "Depois" } });
  });
});
