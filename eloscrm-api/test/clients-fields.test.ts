import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `cli-f-${stamp}@eloscrm.test`, `cli-f-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("campos do perfil do lead", () => {
  it("cria com os campos novos e devolve os valores", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: {
        name: "Helena Ruiz",
        description: "Indicada pela Fernanda.\nProcura casa térrea.",
        tags: ["indicacao", "casa-terrea"],
        temperature: "QUENTE",
        interestType: "Casa",
        budgetMin: 500000,
        budgetMax: 800000,
      },
    });

    expect(res.statusCode).toBe(201);
    const client = res.json();
    expect(client.tags).toEqual(["indicacao", "casa-terrea"]);
    expect(client.temperature).toBe("QUENTE");
    expect(client.interestType).toBe("Casa");
  });

  it("rejeita temperatura fora do enum (422)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Inválido", temperature: "MORNINHO" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("audita a mudança dos campos novos", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead Esquenta", temperature: "FRIO" },
    });
    const client = created.json();

    await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { temperature: "QUENTE", tags: ["retomada"] },
    });

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: client.id },
      orderBy: { createdAt: "asc" },
    });

    expect(events).toHaveLength(2);
    expect(events[1].changes).toEqual({
      temperature: { from: "FRIO", to: "QUENTE" },
      tags: { from: [], to: ["retomada"] },
    });
  });

  it("filtra por temperatura e por tag", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Filtro Quente", temperature: "QUENTE", tags: ["vip"] },
    });

    const byTemp = await app.inject({
      method: "GET",
      url: "/v1/clients?temperature=QUENTE",
      headers: { cookie },
    });
    expect(byTemp.statusCode).toBe(200);
    expect(byTemp.json().every((c: { temperature: string }) => c.temperature === "QUENTE")).toBe(true);

    const byTag = await app.inject({ method: "GET", url: "/v1/clients?tag=vip", headers: { cookie } });
    expect(byTag.statusCode).toBe(200);
    expect(byTag.json().some((c: { name: string }) => c.name === "Filtro Quente")).toBe(true);
  });
});
