import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieOrgB = "";
let orgId = "";
let dealId = "";
let clientId = "";
let commentId = "";
let attachmentId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `dtl-a-${stamp}@eloscrm.test`, `dtl-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `dtl-b-${stamp}@eloscrm.test`, `dtl-b-${stamp}`));

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = pipelines.json()[0];

  const client = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead do negócio" },
  });
  clientId = client.json().id;

  // CREATED entra na timeline como AUDIT; o PATCH abaixo vira STAGE_CHANGED
  const created = await app.inject({
    method: "POST",
    url: "/v1/deals",
    headers: { cookie },
    payload: { clientId, title: "Cobertura na praia", pipelineId: pipeline.id, stageId: pipeline.stages[0].id },
  });
  dealId = created.json().id;

  await app.inject({
    method: "PATCH",
    url: `/v1/deals/${dealId}`,
    headers: { cookie },
    payload: { stageId: pipeline.stages[1].id },
  });

  await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: { cookie },
    payload: { type: "VISIT", description: "Visita ao apartamento", dealId },
  });

  const comment = await app.inject({
    method: "POST",
    url: "/v1/comments",
    headers: { cookie },
    payload: { entityType: "DEAL", entityId: dealId, body: "Cliente quer negociar o valor." },
  });
  commentId = comment.json().id;

  const asked = await app.inject({
    method: "POST",
    url: "/v1/attachments/upload-url",
    headers: { cookie },
    payload: {
      entityType: "DEAL",
      entityId: dealId,
      filename: "proposta-assinada.pdf",
      contentType: "application/pdf",
      size: 5,
    },
  });
  const { attachmentId: id, uploadUrl } = asked.json();
  attachmentId = id;
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "content-length": "5" },
    body: "hello",
  });
  await app.inject({ method: "POST", url: `/v1/attachments/${attachmentId}/confirm`, headers: { cookie } });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /v1/deals/:id/timeline", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/deals/${dealId}/timeline` });
    expect(res.statusCode).toBe(401);
  });

  it("funde as quatro fontes do negócio, mais recente primeiro", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/deals/${dealId}/timeline`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json();

    const kinds = new Set(items.map((item: { kind: string }) => item.kind));
    expect(kinds).toEqual(new Set(["ACTIVITY", "AUDIT", "COMMENT", "ATTACHMENT"]));

    const dates = items.map((item: { at: string }) => new Date(item.at).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    // o movimento no funil é o que a timeline do negócio precisa destacar, com nome de estágio
    const stageEvent = items.find(
      (item: { kind: string; payload: { action?: string } }) =>
        item.kind === "AUDIT" && item.payload.action === "STAGE_CHANGED",
    );
    expect(stageEvent.payload.changes.stage.to).toBeTruthy();

    const comment = items.find((item: { id: string }) => item.id === commentId);
    expect(comment.payload.body).toBe("Cliente quer negociar o valor.");
    const attachment = items.find((item: { id: string }) => item.id === attachmentId);
    expect(attachment.payload.filename).toBe("proposta-assinada.pdf");
  });

  it("não mistura a timeline do negócio com a do lead", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/comments",
      headers: { cookie },
      payload: { entityType: "CLIENT", entityId: clientId, body: "Comentário que é do lead, não do negócio." },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/deals/${dealId}/timeline?limit=100`,
      headers: { cookie },
    });
    const bodies = res
      .json()
      .filter((item: { kind: string }) => item.kind === "COMMENT")
      .map((item: { payload: { body: string } }) => item.payload.body);
    expect(bodies).toContain("Cliente quer negociar o valor.");
    expect(bodies).not.toContain("Comentário que é do lead, não do negócio.");
  });

  it("traz atividade antiga concluída agora pela data do fato, não pelo createdAt", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.activity.create({
        data: { organizationId: orgId, dealId, type: "CALL", description: `Ligação recente ${i}` },
      });
    }

    const oldActivity = await prisma.activity.create({
      data: {
        organizationId: orgId,
        dealId,
        type: "CALL",
        description: "Ligação antiga, concluída agora",
        createdAt: new Date("2020-01-01T09:00:00Z"),
        doneAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/deals/${dealId}/timeline?limit=4`,
      headers: { cookie },
    });
    expect(res.json()[0].id).toBe(oldActivity.id);
  });

  it("não entrega a timeline de negócio de outra organização (404)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/deals/${dealId}/timeline`,
      headers: { cookie: cookieOrgB },
    });
    expect(res.statusCode).toBe(404);
  });

  it("recusa limit acima de 100 (422)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/deals/${dealId}/timeline?limit=101`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
  });
});
