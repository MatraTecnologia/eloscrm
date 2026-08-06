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
    // default da coluna nova: evento antigo, gravado sem `source`, conta como ação de pessoa
    expect(found[0].source).toBe("USER");
  });

  it("guarda rótulo, contexto, snapshot e origem técnica na própria linha", async () => {
    const created = await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        organizationName: "Imobiliária de Teste",
        entityType: AuditEntity.CONVERSATION,
        entityId: "conversa-1",
        entityLabel: "Ana Paula Ribeiro",
        action: AuditAction.DELETED,
        source: "SYSTEM",
        actorName: "Sistema",
        actorEmail: null,
        context: { clientName: "Ana Paula Ribeiro" },
        snapshot: { messageCount: 42, phoneMasked: "(43) *****-**29" },
        ip: "203.0.113.10",
        userAgent: "Mozilla/5.0",
        requestId: "req-1",
      },
    });

    const found = await prisma.auditEvent.findUniqueOrThrow({ where: { id: created.id } });
    expect(found.entityLabel).toBe("Ana Paula Ribeiro");
    expect(found.organizationName).toBe("Imobiliária de Teste");
    expect(found.source).toBe("SYSTEM");
    expect(found.context).toEqual({ clientName: "Ana Paula Ribeiro" });
    expect(found.snapshot).toEqual({ messageCount: 42, phoneMasked: "(43) *****-**29" });
    expect(found.requestId).toBe("req-1");
  });

  it("aceita os tipos e ações novos do enum", async () => {
    const created = await prisma.auditEvent.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.WHATSAPP_INSTANCE,
        entityId: "instancia-1",
        action: AuditAction.CONNECTED,
        actorName: "Gestor",
      },
    });
    expect(created.entityType).toBe("WHATSAPP_INSTANCE");
    expect(created.action).toBe("CONNECTED");
  });
});
