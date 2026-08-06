import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity, AuditSource, Prisma } from "../src/generated/prisma/client.js";
import { diffFields, recordAudit } from "../src/lib/audit.js";
import { labelOf, maskEmail, maskPhone, snapshotOf } from "../src/lib/audit-snapshot.js";
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
    const decimal = new Prisma.Decimal("500000");
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

  it("grava ação sem diff — arquivar não tem `changes` e não pode ser suprimido", async () => {
    await recordAudit({
      orgId,
      entityType: AuditEntity.CONVERSATION,
      entityId: "conversa-arquivada",
      entityLabel: "Ana Paula",
      action: AuditAction.ARCHIVED,
      actor: { id: "user-9", name: "Corretora Ana" },
    });

    const [event] = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityId: "conversa-arquivada" },
    });
    expect(event.action).toBe(AuditAction.ARCHIVED);
    expect(event.entityLabel).toBe("Ana Paula");
  });

  it("copia origem e e-mail do ator, e o nome da organização", async () => {
    await recordAudit({
      orgId,
      entityType: AuditEntity.CLIENT,
      entityId: "cliente-com-origem",
      action: AuditAction.CREATED,
      actor: {
        id: "",
        name: "Automação",
        source: AuditSource.AUTOMATION,
        ip: "203.0.113.7",
        requestId: "req-42",
      },
    });

    const [event] = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityId: "cliente-com-origem" },
    });
    expect(event.source).toBe(AuditSource.AUTOMATION);
    // id vazio é o ator sintético: a coluna guarda null em vez de string que não casa com usuário
    expect(event.actorId).toBeNull();
    expect(event.ip).toBe("203.0.113.7");
    expect(event.requestId).toBe("req-42");
    expect(event.organizationName).toBeTruthy();
  });
});

describe("audit-snapshot", () => {
  it("mascara telefone preservando DDD e os dois últimos dígitos", () => {
    expect(maskPhone("(43) 99183-4229")).toBe("(43) *****-**29");
    expect(maskPhone("554391834229")).toBe("(43) ****-**29");
    expect(maskPhone(null)).toBeNull();
  });

  it("mascara e-mail preservando o domínio", () => {
    expect(maskEmail("ana.paula@gmail.com")).toBe("an***@gmail.com");
    expect(maskEmail("sem-arroba")).toBe("***");
    expect(maskEmail(undefined)).toBeNull();
  });

  it("copia só o que a allowlist permite e mascara os derivados", () => {
    const snapshot = snapshotOf(AuditEntity.CLIENT, {
      name: "Ana Paula",
      phone: "(43) 99183-4229",
      email: "ana@gmail.com",
      source: "WHATSAPP",
      temperature: "HOT",
      // fora da allowlist: não pode aparecer no snapshot
      notes: "anotação interna que não é dado de auditoria",
    });

    expect(snapshot).toEqual({
      source: "WHATSAPP",
      temperature: "HOT",
      phoneMasked: "(43) *****-**29",
      emailMasked: "an***@gmail.com",
    });
  });

  it("não guarda texto de mensagem", () => {
    const snapshot = snapshotOf(AuditEntity.WHATSAPP_MESSAGE, {
      direction: "outbound",
      type: "text",
      text: "proposta enviada ao cliente",
      mediaKey: "org/x/y.jpg",
      sentAt: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(snapshot).toEqual({
      direction: "outbound",
      type: "text",
      sentAt: "2026-08-06T12:00:00.000Z",
    });
  });

  it("rótulo cai no primeiro campo informativo e trunca texto longo", () => {
    expect(labelOf({ title: "Apto 302" })).toBe("Apto 302");
    expect(labelOf({ description: "x".repeat(200) })).toHaveLength(120);
    expect(labelOf({ id: "cly123" })).toBeNull();
  });
});
