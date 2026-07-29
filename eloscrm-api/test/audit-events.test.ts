import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";
let clientId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `ev-a-${stamp}@eloscrm.test`, `ev-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `ev-b-${stamp}@eloscrm.test`, `ev-b-${stamp}`));

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Cliente com histórico" },
  });
  clientId = created.json().id;
  await app.inject({
    method: "PATCH",
    url: `/v1/clients/${clientId}`,
    headers: { cookie },
    payload: { phone: "43988887777" },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/audit-events", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit-events?entityType=CLIENT&entityId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("valida entityType fora do enum (422)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/audit-events?entityType=BANANA&entityId=x",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("lista o histórico da entidade, mais recente primeiro", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit-events?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(events.map((e: { action: string }) => e.action)).toEqual(["UPDATED", "CREATED"]);
    expect(events[0].changes).toEqual({ phone: { from: null, to: "43988887777" } });
  });

  it("não vaza histórico de outra organização", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit-events?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
