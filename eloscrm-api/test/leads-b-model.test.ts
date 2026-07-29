import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditEntity, LeadTemperature } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `leads-b-${stamp}@eloscrm.test`, `leads-b-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo do lead ampliado", () => {
  it("persiste descrição, tags, temperatura, interesse e faixa de orçamento", async () => {
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Lead Completo",
        description: "Casal com dois filhos.\nQuer escola perto.",
        tags: ["financiamento", "urgente"],
        temperature: LeadTemperature.QUENTE,
        interestType: "Apartamento",
        budgetMin: 400000,
        budgetMax: 650000,
      },
    });

    expect(client.tags).toEqual(["financiamento", "urgente"]);
    expect(client.temperature).toBe(LeadTemperature.QUENTE);
    expect(client.description).toContain("escola perto");
    expect(String(client.budgetMin)).toBe("400000");
  });

  it("usa MORNO como temperatura padrão e tags vazias", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead Padrão" },
    });
    expect(client.temperature).toBe(LeadTemperature.MORNO);
    expect(client.tags).toEqual([]);
  });
});

describe("modelo Comment", () => {
  it("grava comentário com autor em snapshot e filtra por entidade", async () => {
    await prisma.comment.create({
      data: {
        organizationId: orgId,
        entityType: AuditEntity.CLIENT,
        entityId: "lead-1",
        authorId: "user-1",
        authorName: "Corretora Ana",
        body: "Cliente pediu para ligar depois das 18h.",
      },
    });

    const found = await prisma.comment.findMany({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: "lead-1" },
    });

    expect(found).toHaveLength(1);
    expect(found[0].authorName).toBe("Corretora Ana");
    expect(found[0].editedAt).toBeNull();
  });
});
