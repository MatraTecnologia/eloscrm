import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { auditSignIn } from "../src/modules/audit/identity.audit.js";
import { makeApp } from "./helpers/app.js";
import { signIn, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const email = `ident-${stamp}@eloscrm.test`;
let orgId = "";

const eventsOf = (entityType: AuditEntity, action: AuditAction) =>
  prisma.auditEvent.findMany({
    where: { organizationId: orgId, entityType, action },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, email, `ident-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de identidade", () => {
  it("criar a imobiliária vira evento da própria organização", async () => {
    const [evento] = await eventsOf(AuditEntity.ORGANIZATION, AuditAction.CREATED);
    expect(evento).toBeTruthy();
    expect(evento.entityId).toBe(orgId);
    expect(evento.entityLabel).toBe(`ident-${stamp}`);
    expect(evento.actorEmail).toBe(email);
  });

  it("login vira SIGNED_IN com a organização ativa da sessão", async () => {
    // o sign-in do helper acontece antes de existir organização, e evento sem tenant não é gravado;
    // este login é o primeiro em que o usuário já tem imobiliária
    await signIn(app, email);

    const eventos = await eventsOf(AuditEntity.SESSION, AuditAction.SIGNED_IN);
    expect(eventos.length).toBeGreaterThanOrEqual(1);
    const ultimo = eventos[eventos.length - 1];
    expect(ultimo.actorEmail).toBe(email);
    expect(ultimo.entityLabel).toBe("Corretor Teste");
  });

  it("logout vira SIGNED_OUT", async () => {
    const cookie = await signIn(app, email);
    const res = await app.inject({ method: "POST", url: "/api/auth/sign-out", headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const eventos = await eventsOf(AuditEntity.SESSION, AuditAction.SIGNED_OUT);
    expect(eventos.length).toBeGreaterThanOrEqual(1);
    expect(eventos[eventos.length - 1].actorEmail).toBe(email);
  });

  it("falha ao auditar não derruba a autenticação", async () => {
    // organização inexistente viola a FK e faz o recordAudit lançar; o adaptador tem de engolir,
    // senão um erro de escrita da auditoria trancaria o login de todo mundo
    await expect(
      auditSignIn({
        id: `sessao-fantasma-${stamp}`,
        userId: "usuario-que-nao-existe",
        activeOrganizationId: "org-que-nao-existe",
      }),
    ).resolves.toBeUndefined();
  });
});
