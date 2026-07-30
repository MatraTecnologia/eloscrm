import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ClientStatus, NurtureReason } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `nurture-m-${stamp}@eloscrm.test`, `nurture-m-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("modelo de nutrição", () => {
  it("nasce ACTIVE com os campos de nutrição vazios", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead recém-criado" },
    });

    expect(client.status).toBe(ClientStatus.ACTIVE);
    expect(client.nurtureReason).toBeNull();
    expect(client.nurtureNote).toBeNull();
    expect(client.nurtureUntil).toBeNull();
    expect(client.nurturedAt).toBeNull();
  });

  it("aceita o estado de nutrição completo e volta a zerar", async () => {
    const until = new Date("2026-12-31T23:59:59.999Z");
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Lead em nutrição",
        status: ClientStatus.NURTURING,
        nurtureReason: NurtureReason.SEM_ORCAMENTO,
        nurtureNote: "Quer esperar a taxa cair",
        nurtureUntil: until,
        nurturedAt: new Date(),
      },
    });

    expect(client.status).toBe(ClientStatus.NURTURING);
    expect(client.nurtureReason).toBe(NurtureReason.SEM_ORCAMENTO);
    expect(client.nurtureUntil?.toISOString()).toBe(until.toISOString());

    const back = await prisma.client.update({
      where: { id: client.id },
      data: {
        status: ClientStatus.ACTIVE,
        nurtureReason: null,
        nurtureNote: null,
        nurtureUntil: null,
        nurturedAt: null,
      },
    });

    expect(back.status).toBe(ClientStatus.ACTIVE);
    expect(back.nurtureReason).toBeNull();
  });

  // nutrição e temperatura são eixos ortogonais: quem comprou com o concorrente ontem tem interesse
  // altíssimo e retomada em dois anos. Um campo não pode estar substituindo o outro.
  it("convive com temperature sem conflito", async () => {
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Lead quente adormecido",
        temperature: "QUENTE",
        status: ClientStatus.NURTURING,
        nurtureReason: NurtureReason.COMPROU_COM_OUTRO,
      },
    });

    expect(client.temperature).toBe("QUENTE");
    expect(client.status).toBe(ClientStatus.NURTURING);
  });
});
