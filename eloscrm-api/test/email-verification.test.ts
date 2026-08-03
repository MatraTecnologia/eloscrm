import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { TEST_PASSWORD, signIn } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const rawSignUp = (email: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: TEST_PASSWORD, name: "Corretor Teste" },
  });

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("verificação de e-mail obrigatória", () => {
  it("cadastra sem abrir sessão", async () => {
    const email = `verif-signup-${stamp}@eloscrm.test`;
    const res = await rawSignUp(email);

    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.emailVerified).toBe(false);
  });

  it("recusa o login enquanto o e-mail não é confirmado", async () => {
    const email = `verif-bloqueio-${stamp}@eloscrm.test`;
    await rawSignUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email, password: TEST_PASSWORD },
    });
    // é o 403 que o front traduz em "confirme seu e-mail" com a ação de reenviar
    expect(res.statusCode).toBe(403);
  });

  it("libera o login depois da confirmação", async () => {
    const email = `verif-liberado-${stamp}@eloscrm.test`;
    await rawSignUp(email);
    await prisma.user.update({ where: { email }, data: { emailVerified: true } });

    const cookie = await signIn(app, email);
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it("não vaza a existência da conta no cadastro repetido", async () => {
    const email = `verif-duplicado-${stamp}@eloscrm.test`;
    await rawSignUp(email);

    // com a proteção contra enumeração ligada, cadastrar de novo responde igual a um cadastro novo
    const repeated = await rawSignUp(email);
    expect(repeated.statusCode).toBe(200);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});
