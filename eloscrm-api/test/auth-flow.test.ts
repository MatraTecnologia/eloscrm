import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUp } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const email = `corretor-${stamp}@eloscrm.test`;

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => {
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
    // o helper cobre a confirmação de e-mail, obrigatória para o sign-in abrir sessão
    const cookie = await signUp(app, email);
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(email);
    expect(me.json().userId).toBeTruthy();
  });

  it("bloqueia rota protegida com cookie de sessão adulterado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      // precisa ser o nome real do cookie (advanced.cookiePrefix): com nome desconhecido o teste
      // passaria sem nunca exercitar a verificação de assinatura
      headers: { cookie: "eloscrm.session_token=garbage.invalid.token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
