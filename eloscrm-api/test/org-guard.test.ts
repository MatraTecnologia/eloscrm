import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const asCookie = (raw: string | string[] | undefined) =>
  Array.isArray(raw) ? raw.join("; ") : String(raw);

const signUp = async (email: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "senha123456", name: "Corretor Guard" },
  });
  return asCookie(res.headers["set-cookie"]);
};

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `guard-${stamp}` } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@eloscrm.test` } } });
  await app.close();
  await prisma.$disconnect();
});

describe("orgGuard", () => {
  it("responde 401 sem cookie de sessão (authGuard dispara primeiro)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/org-scope" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("responde 403 quando a sessão não tem organização ativa", async () => {
    const email = `sem-org-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const res = await app.inject({ method: "GET", url: "/v1/org-scope", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NO_ACTIVE_ORG");
  });

  it("expõe o orgId após criar e ativar uma organização", async () => {
    const email = `com-org-${stamp}@eloscrm.test`;
    const cookie = await signUp(email);

    const created = await app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { cookie },
      payload: { name: "Imob Guard", slug: `guard-${stamp}-ativa` },
    });
    expect([200, 201]).toContain(created.statusCode);
    const orgId: string = created.json().id ?? created.json().organization?.id;

    const activated = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie },
      payload: { organizationId: orgId },
    });
    expect(activated.statusCode).toBe(200);
    const activeCookie = activated.headers["set-cookie"]
      ? asCookie(activated.headers["set-cookie"])
      : cookie;

    const res = await app.inject({
      method: "GET",
      url: "/v1/org-scope",
      headers: { cookie: activeCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe(orgId);
  });

  it("recusa set-active de organização da qual o usuário não é membro (cross-tenant)", async () => {
    const emailA = `tenant-a-${stamp}@eloscrm.test`;
    const emailB = `tenant-b-${stamp}@eloscrm.test`;
    const cookieA = await signUp(emailA);
    const cookieB = await signUp(emailB);

    // A cria a org A, que fica ativa para A por padrão.
    const createdA = await app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { cookie: cookieA },
      payload: { name: "Imob A", slug: `guard-${stamp}-cross` },
    });
    expect([200, 201]).toContain(createdA.statusCode);
    const orgAId: string = createdA.json().id ?? createdA.json().organization?.id;

    // B, sem nenhuma org própria, tenta ativar a org de A.
    const hijack = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie: cookieB },
      payload: { organizationId: orgAId },
    });
    expect(hijack.statusCode).not.toBe(200);

    // B continua sem org ativa: o enforcement do checkMembership do Better Auth se refletiu na sessão.
    const res = await app.inject({
      method: "GET",
      url: "/v1/org-scope",
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NO_ACTIVE_ORG");
  });
});
