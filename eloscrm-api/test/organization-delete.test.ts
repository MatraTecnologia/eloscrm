import { Readable } from "node:stream";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { R2_PRIVATE_BUCKET, headFile, uploadStream } from "../src/lib/storage.js";
import { makeApp } from "./helpers/app.js";
import { signIn, signUp, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

const remoteDelete = vi.fn();
vi.mock("../src/lib/uazapi/index.js", () => ({
  createUazapiClient: () => ({ instance: { delete: remoteDelete } }),
}));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  remoteDelete.mockResolvedValue({ success: true, data: {} });
});

const existeNoBucket = async (key: string) =>
  !!(await headFile(R2_PRIVATE_BUCKET, key).catch(() => null));

/** Imobiliária com dono, lead, negócio, conversa, anexo (objeto real) e WhatsApp conectado. */
const montarOrg = async () => {
  const sufixo = `del-${seq++}-${stamp}`;
  const { cookie, orgId } = await signUpWithOrg(app, `${sufixo}@eloscrm.test`, sufixo);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  const client = await prisma.client.create({
    data: { organizationId: orgId, name: "Lead Da Org" },
  });
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: "Funil", position: 0 },
  });
  const stage = await prisma.stage.create({
    data: { organizationId: orgId, pipelineId: pipeline.id, name: "Contato", position: 0 },
  });
  await prisma.deal.create({
    data: {
      organizationId: orgId,
      clientId: client.id,
      title: "Negócio Da Org",
      pipelineId: pipeline.id,
      stageId: stage.id,
    },
  });
  await prisma.comment.create({
    data: {
      organizationId: orgId,
      entityType: "CLIENT",
      entityId: client.id,
      authorId: "user-x",
      authorName: "Corretor Teste",
      body: "comentário que vai junto",
    },
  });

  const anexoKey = `org/${orgId}/CLIENT/${client.id}/contrato-${stamp}.txt`;
  await uploadStream(R2_PRIVATE_BUCKET, anexoKey, Readable.from([Buffer.from("contrato")]), "text/plain");
  await prisma.attachment.create({
    data: {
      organizationId: orgId,
      entityType: "CLIENT",
      entityId: client.id,
      key: anexoKey,
      filename: "contrato.txt",
      contentType: "text/plain",
      size: 8,
      status: "READY",
      uploadedById: "user-x",
      uploadedByName: "Corretor Teste",
    },
  });

  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-${sufixo}`,
      name: "principal",
      status: "connected",
      ownerJid: "554391834229",
      tokenEnc: encryptToken(`tok-${sufixo}`),
      tokenHash: hashToken(`tok-${sufixo}`),
      webhookSecret: `secret-${sufixo}`,
    },
  });
  const conversation = await prisma.conversation.create({
    data: { organizationId: orgId, instanceId: instance.id, chatid: `${sufixo}@s.whatsapp.net` },
  });
  const midiaKey = `org/${orgId}/whatsapp/${conversation.id}/foto-${stamp}.jpg`;
  await uploadStream(R2_PRIVATE_BUCKET, midiaKey, Readable.from([Buffer.from("foto")]), "image/jpeg");
  await prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId: conversation.id,
      providerId: `owner:${sufixo}`,
      direction: "inbound",
      type: "image",
      mediaKey: midiaKey,
      mediaStatus: "ready",
      mediaSize: 4,
      sentAt: new Date(),
    },
  });

  return { cookie, orgId, slug: org.slug, anexoKey, midiaKey };
};

const preview = (cookie: string) =>
  app.inject({ method: "GET", url: "/v1/organization/deletion-preview", headers: { cookie } });

const excluir = (cookie: string, confirm: string) =>
  app.inject({
    method: "DELETE",
    url: "/v1/organization",
    headers: { cookie },
    payload: { confirm },
  });

describe("GET /v1/organization/deletion-preview", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/organization/deletion-preview" });
    expect(res.statusCode).toBe(401);
  });

  it("lista o que a exclusão vai levar, incluindo bucket e WhatsApp", async () => {
    const { cookie, slug } = await montarOrg();

    const res = await preview(cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.organization.slug).toBe(slug);
    expect(body.counts).toMatchObject({
      clients: 1,
      deals: 1,
      comments: 1,
      attachments: 1,
      conversations: 1,
      whatsappMessages: 1,
      members: 1,
    });
    // a auditoria da criação da organização já está lá, e ela some junto
    expect(body.counts.auditEvents).toBeGreaterThan(0);
    // o que o cascade não alcança: dois objetos (anexo + mídia) e a conexão no provedor
    expect(body.storage.objects).toBe(2);
    expect(body.storage.bytes).toBe(12);
    expect(body.whatsapp).toMatchObject({ name: "principal", connected: true });
  });

  it("é do dono: admin não vê a prévia (403)", async () => {
    const { orgId } = await montarOrg();
    const email = `admin-prev-${seq++}-${stamp}@eloscrm.test`;
    let adminCookie = await signUp(app, email);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.member.create({ data: { organizationId: orgId, userId: admin.id, role: "admin" } });
    const ativada = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie: adminCookie },
      payload: { organizationId: orgId },
    });
    const setCookie = ativada.headers["set-cookie"];
    if (setCookie) adminCookie = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);

    const res = await preview(adminCookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("DELETE /v1/organization", () => {
  it("recusa confirmação errada e não apaga nada (422)", async () => {
    const { cookie, orgId, anexoKey } = await montarOrg();

    const res = await excluir(cookie, "slug-que-nao-e-o-dela");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("CONFIRMATION_MISMATCH");

    // nada foi tocado: nem a organização, nem o objeto no bucket
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).not.toBeNull();
    expect(await existeNoBucket(anexoKey)).toBe(true);
    expect(remoteDelete).not.toHaveBeenCalled();
  });

  it("recusa corpo sem confirmação (422)", async () => {
    const { cookie } = await montarOrg();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/organization",
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it("admin não exclui, mesmo com o slug certo (403)", async () => {
    const { orgId, slug } = await montarOrg();
    const email = `admin-del-${seq++}-${stamp}@eloscrm.test`;
    let adminCookie = await signUp(app, email);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.member.create({ data: { organizationId: orgId, userId: admin.id, role: "admin" } });
    const ativada = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie: adminCookie },
      payload: { organizationId: orgId },
    });
    const setCookie = ativada.headers["set-cookie"];
    if (setCookie) adminCookie = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);

    expect((await excluir(adminCookie, slug)).statusCode).toBe(403);
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).not.toBeNull();
  });

  it("com o slug certo, apaga tudo: banco, bucket e a conexão no provedor", async () => {
    const { cookie, orgId, slug, anexoKey, midiaKey } = await montarOrg();

    expect((await excluir(cookie, slug)).statusCode).toBe(204);

    // banco: a organização e as 13 tabelas que cascateiam dela
    const [org, clients, deals, comments, attachments, conversations, messages, members, events, instance] =
      await Promise.all([
        prisma.organization.findUnique({ where: { id: orgId } }),
        prisma.client.count({ where: { organizationId: orgId } }),
        prisma.deal.count({ where: { organizationId: orgId } }),
        prisma.comment.count({ where: { organizationId: orgId } }),
        prisma.attachment.count({ where: { organizationId: orgId } }),
        prisma.conversation.count({ where: { organizationId: orgId } }),
        prisma.whatsappMessage.count({ where: { organizationId: orgId } }),
        prisma.member.count({ where: { organizationId: orgId } }),
        prisma.auditEvent.count({ where: { organizationId: orgId } }),
        prisma.uazapiInstance.findUnique({ where: { organizationId: orgId } }),
      ]);
    expect(org).toBeNull();
    expect({ clients, deals, comments, attachments, conversations, messages, members, events }).toEqual({
      clients: 0,
      deals: 0,
      comments: 0,
      attachments: 0,
      conversations: 0,
      messages: 0,
      members: 0,
      events: 0,
    });
    expect(instance).toBeNull();

    // bucket: anexo e mídia saem juntos
    expect(await existeNoBucket(anexoKey)).toBe(false);
    expect(await existeNoBucket(midiaKey)).toBe(false);

    // provedor: a instância é apagada na uazapi, senão o número segue conectado lá
    expect(remoteDelete).toHaveBeenCalled();
  });

  it("o usuário continua existindo — quem foi excluída é a imobiliária", async () => {
    const sufixo = `dono-${seq++}-${stamp}`;
    const { cookie, orgId } = await signUpWithOrg(app, `${sufixo}@eloscrm.test`, sufixo);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

    expect((await excluir(cookie, org.slug)).statusCode).toBe(204);

    const user = await prisma.user.findUnique({ where: { email: `${sufixo}@eloscrm.test` } });
    expect(user).not.toBeNull();
    // e ele consegue entrar de novo, para criar outra imobiliária
    expect(await signIn(app, `${sufixo}@eloscrm.test`)).toBeTruthy();
  });

  it("depois da exclusão, as rotas de domínio respondem 403 em vez de 500", async () => {
    const sufixo = `sessao-${seq++}-${stamp}`;
    const { cookie, orgId } = await signUpWithOrg(app, `${sufixo}@eloscrm.test`, sufixo);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    await excluir(cookie, org.slug);

    // a sessão continua apontando para a org que não existe mais; o orgGuard é quem segura
    const res = await app.inject({ method: "GET", url: "/v1/clients", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NO_ACTIVE_ORG");
  });

  it("o endpoint de exclusão do Better Auth está desligado", async () => {
    const sufixo = `porta-${seq++}-${stamp}`;
    const { cookie, orgId } = await signUpWithOrg(app, `${sufixo}@eloscrm.test`, sufixo);

    // porta lateral: apagaria a organização sem confirmação e sem purgar o bucket
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/organization/delete",
      headers: { cookie },
      payload: { organizationId: orgId },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).not.toBeNull();
  });
});
