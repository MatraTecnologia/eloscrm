import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";

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
  ({ cookie } = await signUpWithOrg(app, `agenda-a-${stamp}@eloscrm.test`, `agenda-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `agenda-b-${stamp}@eloscrm.test`, `agenda-b-${stamp}`));
});

afterAll(async () => {
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

  it("traz o cliente vinculado junto de cada atividade", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Cliente da Agenda" },
    });
    const client = clientRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/v1/activities",
      headers: { cookie },
      payload: {
        type: "VISIT",
        description: "Visita ao imóvel",
        clientId: client.id,
        dueAt: new Date("2026-10-05T13:00:00.000Z").toISOString(),
      },
    });
    const activity = res.json();

    const agenda = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2026-10-01T00:00:00.000Z&to=2026-10-31T23:59:59.000Z",
      headers: { cookie },
    });
    const found = agenda.json().find((a: { id: string }) => a.id === activity.id);
    expect(found.kind).toBe("ACTIVITY");
    expect(found.payload.client).toEqual({ id: client.id, name: "Cliente da Agenda" });
    expect(found.payload.deal).toBeNull();
  });

  it("não vaza atividades entre organizações (cross-tenant)", async () => {
    const activityA = await createActivity({ cookie }, "Compromisso privado A", new Date().toISOString());

    const resB = await app.inject({ method: "GET", url: "/v1/agenda", headers: { cookie: cookieB } });
    expect(resB.statusCode).toBe(200);
    expect(resB.json().some((a: { id: string }) => a.id === activityA.id)).toBe(false);
  });

  it("traz o lead a retomar dentro do range, com kind próprio", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead a retomar", phone: "+5543999140409" },
    });
    const client = clientRes.json();

    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: {
        reason: "ADIADO",
        note: "Volta depois da obra",
        until: "2026-11-20T23:59:59.999Z",
      },
    });

    const dentro = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2026-11-01T00:00:00.000Z&to=2026-11-30T23:59:59.000Z",
      headers: { cookie },
    });
    const item = dentro.json().find((i: { id: string }) => i.id === client.id);
    expect(item.kind).toBe("NURTURE");
    expect(item.payload.clientName).toBe("Lead a retomar");
    expect(item.payload.reason).toBe("ADIADO");
    expect(item.payload.note).toBe("Volta depois da obra");
    expect(item.at).toBe("2026-11-20T23:59:59.999Z");

    const fora = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2026-12-01T00:00:00.000Z&to=2026-12-31T23:59:59.000Z",
      headers: { cookie },
    });
    expect(fora.json().some((i: { id: string }) => i.id === client.id)).toBe(false);
  });

  it("não traz lead nutrido sem data de retomada", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead sem data na agenda" },
    });
    const client = clientRes.json();
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "SEM_RESPOSTA" },
    });

    const res = await app.inject({ method: "GET", url: "/v1/agenda", headers: { cookie } });
    expect(res.json().some((i: { id: string }) => i.id === client.id)).toBe(false);
  });

  it("ordena as duas fontes juntas por data crescente", async () => {
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: { cookie },
      payload: { name: "Lead da ordenação" },
    });
    const client = clientRes.json();
    await app.inject({
      method: "POST",
      url: `/v1/clients/${client.id}/nurture`,
      headers: { cookie },
      payload: { reason: "ADIADO", until: "2027-03-15T12:00:00.000Z" },
    });
    const activity = await createActivity(
      { cookie },
      "Ligação antes da retomada",
      new Date("2027-03-10T12:00:00.000Z").toISOString(),
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/agenda?from=2027-03-01T00:00:00.000Z&to=2027-03-31T23:59:59.000Z",
      headers: { cookie },
    });
    const ids = res.json().map((i: { id: string }) => i.id);
    expect(ids.indexOf(activity.id)).toBeLessThan(ids.indexOf(client.id));
  });
});
