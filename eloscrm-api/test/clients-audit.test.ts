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

const eventsOf = (entityId: string) =>
  prisma.auditEvent.findMany({
    where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `cli-audit-${stamp}@eloscrm.test`, `cli-audit-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auditoria de clientes", () => {
  it("registra criação, alteração e remoção com o autor da sessão", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Mariana Costa", source: "SITE" },
    });
    const client = created.json();

    const afterCreate = await eventsOf(client.id);
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0].action).toBe(AuditAction.CREATED);
    // o helper de sessão faz sign-up com name "Corretor Teste"
    expect(afterCreate[0].actorName).toBe("Corretor Teste");

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { name: "Mariana Costa Silva", phone: "43999998888" },
    });

    const afterUpdate = await eventsOf(client.id);
    expect(afterUpdate).toHaveLength(2);
    expect(afterUpdate[1].action).toBe(AuditAction.UPDATED);
    expect(afterUpdate[1].changes).toEqual({
      name: { from: "Mariana Costa", to: "Mariana Costa Silva" },
      phone: { from: null, to: "43999998888" },
    });

    await app.inject({ method: "DELETE", url: `/v1/clients/${client.id}`, headers: { cookie } });

    const afterDelete = await eventsOf(client.id);
    expect(afterDelete).toHaveLength(3);
    expect(afterDelete[2].action).toBe(AuditAction.DELETED);
  });

  it("o evento de exclusão sobrevive ao lead e continua legível", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Cliente Que Foi Apagado", phone: "43991834229", source: "WHATSAPP" },
    });
    const client = created.json();

    await app.inject({ method: "DELETE", url: `/v1/clients/${client.id}`, headers: { cookie } });

    // o dado foi embora — é justamente aqui que o log precisa se sustentar sozinho
    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();

    const evento = await prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: client.id,
        action: AuditAction.DELETED,
      },
    });
    expect(evento.entityLabel).toBe("Cliente Que Foi Apagado");
    expect(evento.actorName).toBe("Corretor Teste");
    expect(evento.organizationName).toBeTruthy();
    // telefone entra mascarado: o snapshot sobrevive à exclusão pedida pelo titular
    expect(evento.snapshot).toMatchObject({ source: "WHATSAPP", phoneMasked: "(43) *****-**29" });
  });

  it("guarda o rótulo do estado final quando o lead é renomeado", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Nome Antigo" },
    });
    const client = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { name: "Nome Novo" },
    });

    const events = await eventsOf(client.id);
    expect(events[0].entityLabel).toBe("Nome Antigo");
    expect(events[1].entityLabel).toBe("Nome Novo");
  });

  it("registra a origem da request no evento", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie, "user-agent": "vitest-agent" },
      payload: { name: "Lead Com Origem" },
    });
    const client = created.json();

    const [evento] = await eventsOf(client.id);
    expect(evento.source).toBe("USER");
    expect(evento.userAgent).toBe("vitest-agent");
    expect(evento.requestId).toBeTruthy();
    expect(evento.actorEmail).toContain("@eloscrm.test");
  });

  it("não registra evento quando o PATCH não muda nada", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Sem Mudança" },
    });
    const client = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { name: "Sem Mudança" },
    });

    const events = await eventsOf(client.id);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe(AuditAction.CREATED);
  });
});
