import type { FastifyInstance } from "fastify";
import { prisma } from "../../src/lib/prisma.js";

export const asCookie = (raw: string | string[] | undefined) =>
  Array.isArray(raw) ? raw.join("; ") : String(raw);

export const TEST_PASSWORD = "senha123456";

export const signIn = async (app: FastifyInstance, email: string, password = TEST_PASSWORD) => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email, password },
  });
  return asCookie(res.headers["set-cookie"]);
};

/**
 * Cria a conta e devolve o cookie de sessão. Com `requireEmailVerification` ligado o sign-up **não**
 * cria sessão: a suíte marca o e-mail como verificado direto no banco (o link de confirmação nunca
 * chega — o mailer é no-op nos testes) e só então faz o sign-in.
 */
export const signUp = async (app: FastifyInstance, email: string) => {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: TEST_PASSWORD, name: "Corretor Teste" },
  });
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  return signIn(app, email);
};

export const signUpWithOrg = async (app: FastifyInstance, email: string, slug: string) => {
  const cookie = await signUp(app, email);
  const created = await app.inject({
    method: "POST",
    url: "/api/auth/organization/create",
    headers: { cookie },
    payload: { name: slug, slug },
  });
  const orgId: string = created.json().id ?? created.json().organization?.id;
  const activated = await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { cookie },
    payload: { organizationId: orgId },
  });
  const activeCookie = activated.headers["set-cookie"] ? asCookie(activated.headers["set-cookie"]) : cookie;
  return { cookie: activeCookie, orgId };
};
