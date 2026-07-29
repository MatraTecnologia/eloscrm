import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
const email = `members-${stamp}@eloscrm.test`;

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, email, `members-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/members", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/members" });
    expect(res.statusCode).toBe(401);
  });

  it("lista quem é da organização ativa com nome, e-mail e papel", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/members", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const members = res.json();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ email, name: "Corretor Teste", role: "owner" });
    expect(members[0].userId).toBeTruthy();
  });
});
