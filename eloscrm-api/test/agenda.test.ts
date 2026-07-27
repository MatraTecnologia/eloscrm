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

const createActivity = async (headers: { cookie: string }, description: string, dueAt?: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers,
    payload: { type: "CALL", description, dueAt },
  });
  return res.json();
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `agenda-a-${stamp}@eloscrm.test`, `agenda-a-${stamp}`));
  ({ cookie: cookieB, orgId: orgBId } = await signUpWithOrg(app, `agenda-b-${stamp}@eloscrm.test`, `agenda-b-${stamp}`));
});

afterAll(async () => {
  await prisma.activity.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `agenda-` } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@eloscrm.test` } } });
  await app.close();
  await prisma.$disconnect();
});

describe("agenda", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/agenda" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("retorna só as atividades com dueAt dentro do range informado", async () => {
    const dentro = await createActivity(
      { cookie },
      "Ligação dentro do range",
      new Date("2026-08-10T12:00:00.000Z").toISOString(),
    );
    const foraAntes = await createActivity(
      { cookie },
      "Ligação antes do range",
      new Date("2026-07-01T12:00:00.000Z").toISOString(),
    );
    const foraDepois = await createActivity(
      { cookie },
      "Ligação depois do range",
      new Date("2026-09-15T12:00:00.000Z").toISOString(),
    );
    const semDueAt = await createActivity({ cookie }, "Anotação sem prazo");

    const res = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.000Z",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((a: { id: string }) => a.id);

    expect(ids).toContain(dentro.id);
    expect(ids).not.toContain(foraAntes.id);
    expect(ids).not.toContain(foraDepois.id);
    expect(ids).not.toContain(semDueAt.id);
  });

  it("não vaza atividades entre organizações (cross-tenant)", async () => {
    const activityA = await createActivity({ cookie }, "Compromisso privado A", new Date().toISOString());

    const resB = await app.inject({ method: "GET", url: "/v1/agenda", headers: { cookie: cookieB } });
    expect(resB.statusCode).toBe(200);
    expect(resB.json().some((a: { id: string }) => a.id === activityA.id)).toBe(false);
  });
});
