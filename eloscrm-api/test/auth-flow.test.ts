import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const email = `corretor-${stamp}@eloscrm.test`;

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await app.close();
  await prisma.$disconnect();
});

describe("auth flow", () => {
  it("bloqueia /v1/me sem sessão", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("cria conta e retorna sessão em /v1/me", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email, password: "senha123456", name: "Corretor Teste" },
    });
    expect([200, 201]).toContain(signup.statusCode);
    const cookie = signup.headers["set-cookie"];
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: Array.isArray(cookie) ? cookie.join("; ") : String(cookie) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
    expect(me.json().userId).toBeTruthy();
  });

  it("bloqueia rota protegida com cookie de sessão adulterado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: "better-auth.session_token=garbage.invalid.token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
