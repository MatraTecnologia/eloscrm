import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { processMessageEvent } from "../src/modules/whatsapp/ingest.service.js";
import { hashToken } from "../src/lib/crypto.js";

vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => ({}) }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";
let instanceId = "";
const SECRET = `segredo-ingest-${stamp}`;
const TOKEN = `tok-ingest-${stamp}`;
const CHATID = "554398414904@s.whatsapp.net";

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `ingest-${stamp}@eloscrm.test`, `ingest-${stamp}`));
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-${stamp}`,
      name: "ingest",
      tokenEnc: "x.y.z",
      tokenHash: hashToken(TOKEN),
      webhookSecret: SECRET,
      status: "connected",
    },
  });
  instanceId = instance.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.whatsappMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
});

// Envelope utilizado para verificar o descarte no receptor autenticado.
const messageEvent = (message: Record<string, unknown>, chat: Record<string, unknown> = {}) => ({
  BaseUrl: "https://matratecnologia.uazapi.com",
  EventType: "messages",
  token: TOKEN,
  owner: "554391834229",
  instanceName: "ingest",
  chatSource: "updated",
  chat: {
    wa_chatid: CHATID,
    phone: "554398414904",
    wa_chatlid: "53176141132007@lid",
    wa_name: "Fulano",
    wa_contactName: "Fulano da Silva",
    wa_isGroup: false,
    ...chat,
  },
  message: {
    id: `554391834229:${message.messageid ?? "MSGDEFAULT"}`,
    messageid: "MSGDEFAULT",
    chatid: CHATID,
    sender: "226070083190831@lid",
    sender_pn: "554398414904@s.whatsapp.net",
    sender_lid: "226070083190831@lid",
    senderName: "Fulano",
    fromMe: false,
    isGroup: false,
    messageTimestamp: 1785817572632,
    wasSentByApi: false,
    ...message,
  },
});

const post = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/webhooks/uazapi/${instanceId}/${SECRET}`, payload: body });

describe("mensagens da uazapi são descartadas", () => {
  it.each([
    { type: "text", text: "Mensagem de teste", fromMe: false },
    { type: "text", text: "Eco de teste", fromMe: true },
    { type: "media", mediaType: "image", content: { URL: "https://example.test/image" } },
    { type: "reaction", reaction: "existing-id", text: "" },
  ])("responde 200 sem persistir mensagem do tipo $type", async message => {
    const payload = messageEvent({ ...message, messageid: "discard-test" });
    expect((await post(payload)).statusCode).toBe(200);
    expect((await post(payload)).statusCode).toBe(200);
    expect(await prisma.conversation.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.messagingContact.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("preserva conversa antiga sem atualizar prévia, contador ou mensagens", async () => {
    const conversation = await prisma.conversation.create({ data: {
      organizationId: orgId, instanceId, chatid: CHATID, unreadCount: 2,
      lastMessageText: "Histórico anterior", lastMessageAt: new Date("2026-10-01T12:00:00Z"),
    } });
    expect((await post(messageEvent({ type: "text", text: "Novo texto" }))).statusCode).toBe(200);
    expect(await prisma.conversation.findUnique({ where: { id: conversation.id } })).toEqual(conversation);
    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("descarta jobs antigos sem persistência", async () => {
    expect(await processMessageEvent({ organizationId: orgId, instanceId, body: messageEvent({ type: "text" }) })).toEqual({ skipped: true });
    expect(await prisma.conversation.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("continua autenticando eventos ignorados", async () => {
    const response = await app.inject({ method: "POST", url: `/webhooks/uazapi/${instanceId}/invalid-secret`, payload: messageEvent({ type: "text" }) });
    expect(response.statusCode).toBe(401);
  });
});
