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
// as duas fontes mais recentes criadas no beforeAll, na ordem em que devem sair da timeline —
// usadas pelo teste do Finding 3 pra conferir os itens, não só a contagem
let lastAttachmentId = "";
let lastCommentId = "";

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
  const commentRes = await app.inject({
    method: "POST",
    url: "/v1/comments",
    headers: { cookie },
    payload: { entityType: "CLIENT", entityId: clientId, body: "Cliente pediu retorno na quinta." },
  });
  lastCommentId = commentRes.json().id;

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
  lastAttachmentId = attachmentId;
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

  it("respeita o limit e devolve os itens mais recentes, não só a contagem", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=2`,
      headers: { cookie },
    });
    const items = res.json();
    expect(items).toHaveLength(2);
    // as duas fontes mais recentes do beforeAll são o anexo e o comentário, nessa ordem
    expect(items[0].id).toBe(lastAttachmentId);
    expect(items[1].id).toBe(lastCommentId);
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

  it("não inclui anexo PENDING (nunca confirmado) na timeline", async () => {
    const asked = await app.inject({
      method: "POST",
      url: "/v1/attachments/upload-url",
      headers: { cookie },
      payload: {
        entityType: "CLIENT",
        entityId: clientId,
        filename: "pendente.pdf",
        contentType: "application/pdf",
        size: 5,
      },
    });
    const { attachmentId } = asked.json();
    // nunca confirmado: fica PENDING de propósito

    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=100`,
      headers: { cookie },
    });
    const items = res.json();
    expect(items.find((i: { id: string }) => i.id === attachmentId)).toBeUndefined();
  });

  it("traz atividade antiga concluída agora pela data do fato, não pelo createdAt", async () => {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

    // três atividades recentes por createdAt, sem doneAt/dueAt — só pra encher o take: limit
    // da query ordenada por createdAt e provar que ela sozinha não basta pra fusão
    for (let i = 0; i < 3; i++) {
      await prisma.activity.create({
        data: {
          organizationId: client.organizationId,
          clientId,
          type: "CALL",
          description: `Atividade recente ${i}`,
        },
      });
    }

    // criada há anos, mas concluída agora — é ela que deveria abrir a timeline
    const oldActivity = await prisma.activity.create({
      data: {
        organizationId: client.organizationId,
        clientId,
        type: "CALL",
        description: "Atividade antiga, concluída agora",
        createdAt: new Date("2020-01-01T09:00:00Z"),
        doneAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/clients/${clientId}/timeline?limit=4`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items[0].id).toBe(oldActivity.id);
  });
});
