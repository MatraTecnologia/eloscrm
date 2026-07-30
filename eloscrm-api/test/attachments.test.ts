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

const BODY = "conteudo do contrato";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie } = await signUpWithOrg(app, `att-a-${stamp}@eloscrm.test`, `att-a-${stamp}`));
  ({ cookie: cookieOrgB } = await signUpWithOrg(app, `att-b-${stamp}@eloscrm.test`, `att-b-${stamp}`));

  const created = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: { cookie },
    payload: { name: "Lead com anexo" },
  });
  clientId = created.json().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const askUpload = (filename: string, contentType = "application/pdf", size = Buffer.byteLength(BODY)) =>
  app.inject({
    method: "POST",
    url: "/v1/attachments/upload-url",
    headers: { cookie },
    payload: { entityType: "CLIENT", entityId: clientId, filename, contentType, size },
  });

/** Sobe o arquivo como o browser faria: PUT direto na URL assinada, sem passar pela API. */
const putToBucket = async (uploadUrl: string, contentType = "application/pdf") => {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(Buffer.byteLength(BODY)) },
    body: BODY,
  });
  expect(res.ok).toBe(true);
};

describe("anexos", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/attachments?entityType=CLIENT&entityId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("recusa tipo fora da allowlist (422)", async () => {
    const res = await askUpload("virus.exe", "application/x-msdownload");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("recusa arquivo acima de 20 MB (422)", async () => {
    const res = await askUpload("grande.pdf", "application/pdf", 21 * 1024 * 1024);
    expect(res.statusCode).toBe(422);
  });

  it("recusa entidade de outra organização (404)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/attachments/upload-url",
      headers: { cookie: cookieOrgB },
      payload: {
        entityType: "CLIENT",
        entityId: clientId,
        filename: "contrato.pdf",
        contentType: "application/pdf",
        size: 10,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("faz o ciclo completo: assina, sobe, confirma, lista, baixa e apaga", async () => {
    const asked = await askUpload("contrato.pdf");
    expect(asked.statusCode).toBe(201);
    const { attachmentId, uploadUrl, key } = asked.json();
    expect(key).toContain(`/CLIENT/${clientId}/`);

    // antes do confirm, a listagem não mostra o anexo
    const pendingList = await app.inject({
      method: "GET",
      url: `/v1/attachments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(pendingList.json()).toEqual([]);

    await putToBucket(uploadUrl);

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/attachments/${attachmentId}/confirm`,
      headers: { cookie },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("READY");
    // o tamanho gravado é o que o bucket reporta, não o que o cliente prometeu
    expect(confirmed.json().size).toBe(Buffer.byteLength(BODY));

    const list = await app.inject({
      method: "GET",
      url: `/v1/attachments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie },
    });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].filename).toBe("contrato.pdf");

    const link = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachmentId}/download-url`,
      headers: { cookie },
    });
    expect(link.statusCode).toBe(200);
    const { url } = link.json();
    const downloaded = await fetch(url);
    expect(await downloaded.text()).toBe(BODY);

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/attachments/${attachmentId}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);

    // o objeto sai do bucket junto com a linha
    const afterDelete = await fetch(url);
    expect(afterDelete.ok).toBe(false);
  });

  it("recusa confirm quando o objeto não foi enviado (422)", async () => {
    const asked = await askUpload("fantasma.pdf");
    const { attachmentId } = asked.json();

    const res = await app.inject({
      method: "POST",
      url: `/v1/attachments/${attachmentId}/confirm`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("não vaza anexo de outra organização", async () => {
    const asked = await askUpload("privado.pdf");
    const { attachmentId, uploadUrl } = asked.json();
    await putToBucket(uploadUrl);
    await app.inject({ method: "POST", url: `/v1/attachments/${attachmentId}/confirm`, headers: { cookie } });

    const list = await app.inject({
      method: "GET",
      url: `/v1/attachments?entityType=CLIENT&entityId=${clientId}`,
      headers: { cookie: cookieOrgB },
    });
    expect(list.json()).toEqual([]);

    const link = await app.inject({
      method: "GET",
      url: `/v1/attachments/${attachmentId}/download-url`,
      headers: { cookie: cookieOrgB },
    });
    expect(link.statusCode).toBe(404);
  });
});
