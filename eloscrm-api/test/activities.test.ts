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

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `activities-a-${stamp}@eloscrm.test`, `activities-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `activities-b-${stamp}@eloscrm.test`, `activities-b-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("activities", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/activities" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("valida corpo inválido no POST (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/activities",
      headers: { cookie },
      payload: { description: "sem type" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("cria, lista, busca, filtra e atualiza uma atividade", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Cliente da Atividade" },
    });
    const client = clientRes.json();

    const created = await app.inject({
      method: "POST",
      url: "/v1/activities",
      headers: { cookie },
      payload: { type: "CALL", description: "Ligar para o cliente", clientId: client.id },
    });
    expect(created.statusCode).toBe(201);
    const activity = created.json();
    expect(activity.id).toBeTruthy();
    expect(activity.organizationId).toBe(orgId);
    expect(activity.type).toBe("CALL");

    const list = await app.inject({ method: "GET", url: "/v1/activities", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((a: { id: string }) => a.id === activity.id)).toBe(true);

    const byId = await app.inject({ method: "GET", url: `/v1/activities/${activity.id}`, headers: { cookie } });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().description).toBe("Ligar para o cliente");

    const byType = await app.inject({ method: "GET", url: "/v1/activities?type=CALL", headers: { cookie } });
    expect(byType.json().some((a: { id: string }) => a.id === activity.id)).toBe(true);

    const byClient = await app.inject({ method: "GET", url: `/v1/activities?clientId=${client.id}`, headers: { cookie } });
    expect(byClient.json().some((a: { id: string }) => a.id === activity.id)).toBe(true);

    const doneAt = new Date().toISOString();
    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/activities/${activity.id}`,
      headers: { cookie },
      payload: { doneAt },
    });
    expect(patched.statusCode).toBe(200);
    expect(new Date(patched.json().doneAt).toISOString()).toBe(doneAt);
  });

  it("não vaza atividade entre organizações (cross-tenant → 404)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/activities",
      headers: { cookie },
      payload: { type: "NOTE", description: "Anotação privada A" },
    });
    const activityA = created.json();

    const byB = await app.inject({ method: "GET", url: `/v1/activities/${activityA.id}`, headers: { cookie: cookieB } });
    expect(byB.statusCode).toBe(404);

    const listB = await app.inject({ method: "GET", url: "/v1/activities", headers: { cookie: cookieB } });
    expect(listB.json().some((a: { id: string }) => a.id === activityA.id)).toBe(false);
  });
});
