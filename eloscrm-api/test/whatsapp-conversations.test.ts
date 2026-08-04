import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/crypto.js";

vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => ({}) }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let cookieB = "";
let instanceId = "";
let conversationId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `conv-${stamp}@eloscrm.test`, `conv-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `conv-b-${stamp}@eloscrm.test`, `conv-b-${stamp}`));
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-conv-${stamp}`,
      name: "conv",
      tokenEnc: "x.y.z",
      tokenHash: hashToken(`tok-conv-${stamp}`),
      webhookSecret: `secret-conv-${stamp}`,
    },
  });
  instanceId = instance.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let seq = 0;
beforeEach(async () => {
  await prisma.whatsappMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      instanceId,
      chatid: `55439999${seq++}@s.whatsapp.net`,
      phone: "554399990000",
      waName: "Fulano",
      unreadCount: 2,
      lastMessageAt: new Date(),
      lastMessageText: "última",
    },
  });
  conversationId = conversation.id;
});

const criarMensagem = (data: Record<string, unknown> = {}) =>
  prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `owner:C${seq++}`,
      providerMessageId: `C${seq}`,
      direction: "inbound",
      type: "text",
      status: "sent",
      text: "oi",
      sentAt: new Date(),
      ...data,
    },
  });

const get = (url: string, c = cookie) => app.inject({ method: "GET", url, headers: { cookie: c } });

describe("GET /v1/whatsapp/conversations", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/whatsapp/conversations" });
    expect(res.statusCode).toBe(401);
  });

  it("lista com o lead vinculado embutido", async () => {
    const lead = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead Ligado", phone: "(43) 99999-0000", phoneKey: "4399990000" },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { clientId: lead.id } });

    const res = await get("/v1/whatsapp/conversations");
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].client.name).toBe("Lead Ligado");
    expect(items[0].unreadCount).toBe(2);
  });

  it("filtra por não lidas e por busca", async () => {
    await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `lida-${stamp}@s.whatsapp.net`, waName: "Beltrano", unreadCount: 0 },
    });

    expect((await get("/v1/whatsapp/conversations?unread=true")).json().items).toHaveLength(1);
    expect((await get("/v1/whatsapp/conversations?q=Beltrano")).json().items).toHaveLength(1);
  });

  it("arquivadas ficam fora da lista padrão", async () => {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { archivedAt: new Date() },
    });

    expect((await get("/v1/whatsapp/conversations")).json().items).toHaveLength(0);
    expect((await get("/v1/whatsapp/conversations?archived=true")).json().items).toHaveLength(1);
  });

  it("não vaza conversa entre organizações", async () => {
    expect((await get("/v1/whatsapp/conversations", cookieB)).json().items).toHaveLength(0);
    expect((await get(`/v1/whatsapp/conversations/${conversationId}`, cookieB)).statusCode).toBe(404);
  });
});

describe("GET /v1/whatsapp/conversations/:id/messages", () => {
  it("devolve em ordem cronológica, do mais antigo para o mais novo", async () => {
    await criarMensagem({ text: "primeira", sentAt: new Date("2026-08-01T10:00:00Z") });
    await criarMensagem({ text: "segunda", sentAt: new Date("2026-08-01T11:00:00Z") });

    const { items } = (await get(`/v1/whatsapp/conversations/${conversationId}/messages`)).json();
    expect(items.map((m: { text: string }) => m.text)).toEqual(["primeira", "segunda"]);
  });

  it("nunca expõe a chave do R2 nem a URL temporária cruas", async () => {
    await criarMensagem({
      type: "image",
      mediaStatus: "ready",
      mediaKey: "org/x/whatsapp/y/z.jpg",
      mediaMime: "image/jpeg",
    });

    const res = await get(`/v1/whatsapp/conversations/${conversationId}/messages`);
    const [msg] = res.json().items;
    expect(msg).not.toHaveProperty("mediaKey");
    expect(msg).not.toHaveProperty("mediaTempUrl");
    // o front recebe URL pronta e não sabe de onde veio
    expect(msg.mediaUrl).toContain("X-Amz-Signature");
    expect(msg.mediaSource).toBe("r2");
  });

  it("mídia ainda na fila entrega a URL temporária do provedor", async () => {
    await criarMensagem({
      type: "image",
      mediaStatus: "pending",
      mediaTempUrl: "https://uazapi.test/temp.jpg",
      mediaTempExpiresAt: new Date(Date.now() + 60_000),
    });

    const [msg] = (await get(`/v1/whatsapp/conversations/${conversationId}/messages`)).json().items;
    expect(msg.mediaUrl).toBe("https://uazapi.test/temp.jpg");
    expect(msg.mediaSource).toBe("provider");
  });

  it("mídia falhada vem sem URL, mas com o thumbnail que veio no webhook", async () => {
    await criarMensagem({
      type: "image",
      mediaStatus: "failed",
      mediaError: "arquivo acima do limite",
      mediaThumb: "/9j/thumb",
    });

    const [msg] = (await get(`/v1/whatsapp/conversations/${conversationId}/messages`)).json().items;
    expect(msg.mediaUrl).toBeNull();
    expect(msg.mediaThumb).toBe("/9j/thumb");
    expect(msg.mediaError).toBe("arquivo acima do limite");
  });

  it("não lê mensagens de conversa de outra organização", async () => {
    const res = await get(`/v1/whatsapp/conversations/${conversationId}/messages`, cookieB);
    expect(res.statusCode).toBe(404);
  });
});

describe("ações da conversa", () => {
  it("marcar como lida zera o contador", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/read`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.unreadCount).toBe(0);
  });

  it("arquiva e desarquiva", async () => {
    const url = `/v1/whatsapp/conversations/${conversationId}`;
    await app.inject({ method: "POST", url: `${url}/archive`, headers: { cookie } });
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).archivedAt,
    ).not.toBeNull();

    await app.inject({ method: "POST", url: `${url}/unarchive`, headers: { cookie } });
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).archivedAt,
    ).toBeNull();
  });

  it("marcar como lida não atravessa organização", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/read`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(404);
  });
});
