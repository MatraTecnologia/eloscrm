import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ClientStatus, NurtureReason } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";

const createClient = async (name: string) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name },
  });
  return res.json() as { id: string; name: string };
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `nurture-${stamp}@eloscrm.test`, `nurture-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("PATCH de cliente e o estado de nutrição", () => {
  it("reagenda a retomada e registra no histórico", async () => {
    const client = await createClient("Lead a reagendar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2026-09-01T23:59:59.999Z") },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: {
        nurtureUntil: "2026-11-30T23:59:59.999Z",
        nurtureReason: "ADIADO",
        nurtureNote: "Vai vender o apartamento antes",
      },
    });

    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.nurtureUntil).toBe("2026-11-30T23:59:59.999Z");
    expect(updated.nurtureReason).toBe(NurtureReason.ADIADO);
    expect(updated.status).toBe(ClientStatus.NURTURING);

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: client.id, action: "UPDATED" },
    });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].changes as object)).toContain("nurtureUntil");
  });

  // a invariante do módulo: se o PATCH pudesse mexer no status, existiria um caminho que muda o
  // estado do lead sem passar pela regra dos negócios abertos
  it("ignora status no PATCH", async () => {
    const client = await createClient("Lead que tentaria burlar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurturedAt: new Date() },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { status: "ACTIVE", nurturedAt: null, name: "Nome novo" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Nome novo");
    expect(res.json().status).toBe(ClientStatus.NURTURING);
    expect(res.json().nurturedAt).not.toBeNull();
  });

  it("limpa o motivo com null", async () => {
    const client = await createClient("Lead com motivo a limpar");
    await prisma.client.update({
      where: { id: client.id },
      data: { status: ClientStatus.NURTURING, nurtureReason: NurtureReason.OUTRO, nurtureNote: "x" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/clients/${client.id}`,
      headers: { cookie },
      payload: { nurtureReason: null, nurtureNote: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().nurtureReason).toBeNull();
    expect(res.json().nurtureNote).toBeNull();
  });
});

describe("listagem de clientes por status", () => {
  let ativo = { id: "", name: "" };
  let nutridoVencido = { id: "", name: "" };
  let nutridoFuturo = { id: "", name: "" };
  let nutridoSemData = { id: "", name: "" };

  beforeAll(async () => {
    ativo = await createClient(`Ativo ${stamp}`);
    nutridoVencido = await createClient(`Vencido ${stamp}`);
    nutridoFuturo = await createClient(`Futuro ${stamp}`);
    nutridoSemData = await createClient(`Sem data ${stamp}`);

    await prisma.client.update({
      where: { id: nutridoVencido.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2020-01-01T00:00:00.000Z") },
    });
    await prisma.client.update({
      where: { id: nutridoFuturo.id },
      data: { status: ClientStatus.NURTURING, nurtureUntil: new Date("2099-01-01T00:00:00.000Z") },
    });
    await prisma.client.update({
      where: { id: nutridoSemData.id },
      data: { status: ClientStatus.NURTURING },
    });
  });

  const list = async (query: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/clients${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { id: string }[]).map((c) => c.id);
  };

  it("sem filtro devolve só os ativos", async () => {
    const ids = await list("");
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(nutridoVencido.id);
    expect(ids).not.toContain(nutridoFuturo.id);
    expect(ids).not.toContain(nutridoSemData.id);
  });

  it("status=NURTURING devolve só os nutridos", async () => {
    const ids = await list("?status=NURTURING");
    expect(ids).not.toContain(ativo.id);
    expect(ids).toContain(nutridoVencido.id);
    expect(ids).toContain(nutridoFuturo.id);
    expect(ids).toContain(nutridoSemData.id);
  });

  it("status=ALL devolve os dois", async () => {
    const ids = await list("?status=ALL");
    expect(ids).toContain(ativo.id);
    expect(ids).toContain(nutridoFuturo.id);
  });

  it("overdue=true traz só os vencidos, e não os sem data", async () => {
    const ids = await list("?status=NURTURING&overdue=true");
    expect(ids).toContain(nutridoVencido.id);
    expect(ids).not.toContain(nutridoFuturo.id);
    expect(ids).not.toContain(nutridoSemData.id);
  });

  // "false" é string com valor booleano true em JS; z.coerce.boolean() aqui devolveria todo mundo
  // como vencido. O parse é explícito por causa disso.
  it("overdue=false não filtra nada", async () => {
    const ids = await list("?status=NURTURING&overdue=false");
    expect(ids).toContain(nutridoFuturo.id);
    expect(ids).toContain(nutridoSemData.id);
  });

  it("busca por nome continua funcionando junto do status", async () => {
    const ids = await list(`?status=NURTURING&q=Vencido ${stamp}`);
    expect(ids).toEqual([nutridoVencido.id]);
  });

  it("GET /clients/:id de lead nutrido continua 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${nutridoFuturo.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(ClientStatus.NURTURING);
  });
});
