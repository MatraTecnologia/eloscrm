import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieB = "";
let orgBId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `clients-a-${stamp}@eloscrm.test`, `clients-a-${stamp}`));
  ({ cookie: cookieB, orgId: orgBId } = await signUpWithOrg(app, `clients-b-${stamp}@eloscrm.test`, `clients-b-${stamp}`));
});

afterAll(async () => {
  await prisma.client.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `clients-` } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@eloscrm.test` } } });
  await app.close();
  await prisma.$disconnect();
});

describe("clients", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/clients" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("valida corpo inválido no POST (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { email: "nao-e-email" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("cria, lista, busca, filtra, atualiza e remove um cliente", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Carlos Silva", source: "SITE", phone: "43999990000" },
    });
    expect(created.statusCode).toBe(201);
    const client = created.json();
    expect(client.id).toBeTruthy();
    expect(client.organizationId).toBe(orgId);
    expect(client.source).toBe("SITE");

    const list = await app.inject({ method: "GET", url: "/v1/clients", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((c: { id: string }) => c.id === client.id)).toBe(true);

    const byId = await app.inject({ method: "GET", url: `/v1/clients/${client.id}`, headers: { cookie } });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().name).toBe("Carlos Silva");

    const filtered = await app.inject({ method: "GET", url: "/v1/clients?q=carlos", headers: { cookie } });
    expect(filtered.json().some((c: { id: string }) => c.id === client.id)).toBe(true);

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { name: "Carlos S. Souza" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe("Carlos S. Souza");

    const removed = await app.inject({ method: "DELETE", url: `/v1/clients/${client.id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({ method: "GET", url: `/v1/clients/${client.id}`, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("NOT_FOUND");
  });

  it("não vaza cliente entre organizações (cross-tenant → 404)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead Privado A" },
    });
    const clientA = created.json();

    const byB = await app.inject({ method: "GET", url: `/v1/clients/${clientA.id}`, headers: { cookie: cookieB } });
    expect(byB.statusCode).toBe(404);

    const listB = await app.inject({ method: "GET", url: "/v1/clients", headers: { cookie: cookieB } });
    expect(listB.json().some((c: { id: string }) => c.id === clientA.id)).toBe(false);
  });
});
