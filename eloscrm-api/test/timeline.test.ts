import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieOrgB = "";
let clientId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `tl-a-${stamp}@eloscrm.test`, `tl-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `tl-b-${stamp}@eloscrm.test`, `tl-b-${stamp}`));

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead da timeline" },
  });
  clientId = created.json().id;

  // uma fonte de cada: alteração auditada, atividade, comentário e anexo confirmado
  await app.inject({
    method: "PATCH",
    url: `/v1/clients/${clientId}`,
    headers: { cookie },
    payload: { phone: "+5543988887777" },
  });
  await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: { cookie },
    payload: { type: "CALL", description: "Primeiro contato", clientId },
  });
  await app.inject({
    method: "POST",
    url: "/v1/comments",
    headers: { cookie },
    payload: { entityType: "CLIENT", entityId: clientId, body: "Cliente pediu retorno na quinta." },
  });

  const asked = await app.inject({
    method: "POST",
    url: "/v1/attachments/upload-url",
    headers: { cookie },
    payload: {
      entityType: "CLIENT",
      entityId: clientId,
      filename: "proposta.pdf",
      contentType: "application/pdf",
      size: 5,
    },
  });
  const { attachmentId, uploadUrl } = asked.json();
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "content-length": "5" },
    body: "hello",
  });
  await app.inject({
    method: "POST",
    url: `/v1/attachments/${attachmentId}/confirm`,
    headers: { cookie },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/clients/:id/timeline", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/clients/${clientId}/timeline` });
    expect(res.statusCode).toBe(401);
  });

  it("funde as quatro fontes, mais recente primeiro", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json();

    const kinds = new Set(items.map((i: { kind: string }) => i.kind));
    expect(kinds).toEqual(new Set(["ACTIVITY", "AUDIT", "COMMENT", "ATTACHMENT"]));

    const dates = items.map((i: { at: string }) => new Date(i.at).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    const comment = items.find((i: { kind: string }) => i.kind === "COMMENT");
    expect(comment.payload.body).toBe("Cliente pediu retorno na quinta.");
    const attachment = items.find((i: { kind: string }) => i.kind === "ATTACHMENT");
    expect(attachment.payload.filename).toBe("proposta.pdf");
  });

  it("respeita o limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=2`,
      headers: { cookie },
    });
    expect(res.json()).toHaveLength(2);
  });

  it("recusa limit acima de 100 (422)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=101`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
  });

  it("não entrega a timeline de cliente de outra organização (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline`,
      headers: { cookie: cookieOrgB },
    });
    expect(res.statusCode).toBe(404);
  });
});
