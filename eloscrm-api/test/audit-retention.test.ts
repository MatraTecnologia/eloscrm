import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import {
  cutoffFor,
  purgeOlderThan,
  runRetention,
  scheduleAuditRetention,
} from "../src/modules/audit/retention.service.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";
let outraOrgId = "";

const DIA_MS = 24 * 60 * 60 * 1000;

const criarEvento = (organizationId: string, diasAtras: number) =>
  prisma.auditEvent.create({
    data: {
      organizationId,
      entityType: AuditEntity.CLIENT,
      entityId: `cliente-${Math.random().toString(36).slice(2, 8)}`,
      action: AuditAction.CREATED,
      actorName: "Corretor Teste",
      createdAt: new Date(Date.now() - diasAtras * DIA_MS),
    },
  });

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `ret-${stamp}@eloscrm.test`, `ret-${stamp}`));
  ({ orgId: outraOrgId } = await signUpWithOrg(app, `ret-b-${stamp}@eloscrm.test`, `ret-b-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// a purga é global (varre por data, sem filtro de org), então cada caso começa da estaca zero nas
// duas organizações deste arquivo
beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [orgId, outraOrgId] } } });
});

const countOf = (organizationId: string) =>
  prisma.auditEvent.count({ where: { organizationId } });

describe("purgeOlderThan", () => {
  it("apaga o que passou do corte e devolve a contagem por organização", async () => {
    await criarEvento(orgId, 500);
    await criarEvento(orgId, 400);
    await criarEvento(outraOrgId, 800);
    await criarEvento(orgId, 10);
    await criarEvento(outraOrgId, 1);

    const { removed, byOrg } = await purgeOlderThan(cutoffFor(365));

    expect(removed).toBe(3);
    expect(byOrg.get(orgId)).toBe(2);
    expect(byOrg.get(outraOrgId)).toBe(1);
    expect(await countOf(orgId)).toBe(1);
    expect(await countOf(outraOrgId)).toBe(1);
  });

  it("varre em lotes até esvaziar — um lote menor que o total não pode parar no meio", async () => {
    for (let i = 0; i < 5; i += 1) await criarEvento(orgId, 400 + i);

    const { removed } = await purgeOlderThan(cutoffFor(365), 2);

    expect(removed).toBe(5);
    expect(await countOf(orgId)).toBe(0);
  });

  it("não apaga nada quando tudo está dentro do prazo", async () => {
    await criarEvento(orgId, 5);
    const { removed } = await purgeOlderThan(cutoffFor(365));
    expect(removed).toBe(0);
    expect(await countOf(orgId)).toBe(1);
  });
});

describe("runRetention", () => {
  it("registra um evento PURGED por organização afetada", async () => {
    await criarEvento(orgId, 500);
    await criarEvento(orgId, 500);
    await criarEvento(outraOrgId, 500);

    const removed = await runRetention(365);
    expect(removed).toBe(3);

    const purgados = await prisma.auditEvent.findMany({
      where: { organizationId: { in: [orgId, outraOrgId] }, action: AuditAction.PURGED },
    });
    expect(purgados).toHaveLength(2);
    const meu = purgados.find((e) => e.organizationId === orgId);
    expect(meu?.entityType).toBe(AuditEntity.ORGANIZATION);
    expect(meu?.source).toBe("SYSTEM");
    expect(meu?.actorName).toBe("Sistema");
    expect(meu?.changes).toEqual({ removed: { from: 2, to: 0 } });
  });

  it("não deixa rastro quando não havia nada a apagar", async () => {
    await criarEvento(orgId, 1);
    expect(await runRetention(365)).toBe(0);
    expect(await countOf(orgId)).toBe(1);
  });
});

describe("agendamento", () => {
  it("sem REDIS_URL não agenda nada e não lança", async () => {
    // é o que mantém teste e CI sem infra: a purga em dev fica por conta do `pnpm audit:purge`
    await expect(scheduleAuditRetention()).resolves.toBeNull();
  });
});
