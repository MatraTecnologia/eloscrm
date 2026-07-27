import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { asCookie } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const signUp = async (email: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "senha123456", name: "Corretor Teste" },
  });
  return asCookie(res.headers["set-cookie"]);
};

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("conta do usuário", () => {
  it("atualiza o nome do próprio usuário", async () => {
    const email = `conta-nome-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      headers: { cookie },
      payload: { name: "Corretor Renomeado" },
    });
    expect(res.statusCode).toBe(200);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.name).toBe("Corretor Renomeado");
  });

  it("bloqueia update-user sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      payload: { name: "Invasor" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("troca o e-mail sem verificação por link", async () => {
    const email = `conta-email-${stamp}@eloscrm.test`;
    const novoEmail = `conta-email-novo-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-email",
      headers: { cookie },
      payload: { newEmail: novoEmail },
    });
    expect(res.statusCode).toBe(200);

    // updateEmailWithoutVerification só vale enquanto o e-mail atual não é verificado; se um dia
    // o projeto ligar verificação, esta expectativa quebra e a UI precisa de outro fluxo
    const user = await prisma.user.findUnique({ where: { email: novoEmail } });
    expect(user).toBeTruthy();
    expect(user?.emailVerified).toBe(false);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("troca a senha e permite entrar com a nova", async () => {
    const email = `conta-senha-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: "senha123456", newPassword: "novasenha123456" },
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email, password: "novasenha123456" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("recusa a troca de senha quando a senha atual está errada", async () => {
    const email = `conta-senha-errada-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: "senha-errada-123", newPassword: "novasenha123456" },
    });
    expect(res.statusCode).not.toBe(200);
    // o código é o que a UI usa para dizer "senha atual incorreta" em vez de um erro genérico
    expect(res.json().code).toBe("INVALID_PASSWORD");
  });

  it("recusa senha nova abaixo do mínimo de 8 caracteres", async () => {
    const email = `conta-senha-curta-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: "senha123456", newPassword: "curta6" },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it("mantém a sessão atual válida ao revogar as demais", async () => {
    const email = `conta-revoga-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie },
      payload: {
        currentPassword: "senha123456",
        newPassword: "novasenha123456",
        revokeOtherSessions: true,
      },
    });
    expect(res.statusCode).toBe(200);

    // o cookie pode ser rotacionado na resposta; o que importa é continuar autenticado
    const rotated = res.headers["set-cookie"] ? asCookie(res.headers["set-cookie"]) : cookie;
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { cookie: rotated } });
    expect(me.statusCode).toBe(200);
  });
});
