import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/crypto.js";

vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => ({}) }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";
let instanceId = "";
let conversationId = "";
const SECRET = `segredo-status-${stamp}`;
const TOKEN = `tok-status-${stamp}`;
const CHATID = `554398414904@s.whatsapp.net`;

beforeAll(async () => {
  app = await makeApp();
  ({ orgId } = await signUpWithOrg(app, `status-${stamp}@eloscrm.test`, `status-${stamp}`));
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-status-${stamp}`,
      name: "status",
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
  const conversation = await prisma.conversation.create({
    data: { organizationId: orgId, instanceId, chatid: CHATID, unreadCount: 3 },
  });
  conversationId = conversation.id;
});

const criarMensagem = (providerMessageId: string, data: Record<string, unknown> = {}) =>
  prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `owner:${providerMessageId}`,
      providerMessageId,
      direction: "outbound",
      type: "text",
      status: "sent",
      sentAt: new Date(),
      ...data,
    },
  });

// Payload real capturado do tráfego (§2.6 do spec).
const recibo = (state: string, ids: string[], extra: Record<string, unknown> = {}) => ({
  BaseUrl: "https://matratecnologia.uazapi.com",
  EventType: "messages_update",
  type: "ReadReceipt",
  state,
  token: TOKEN,
  owner: "554391834229",
  instanceName: "status",
  event: {
    Chat: CHATID,
    MessageIDs: ids,
    Sender: CHATID,
    sender_pn: CHATID,
    sender_lid: "53176141132007@lid",
    IsFromMe: "False",
    IsGroup: "False",
    Timestamp: "1785820620",
    Type: state,
    ...extra,
  },
});

const post = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/webhooks/uazapi/${instanceId}/${SECRET}`, payload: body });

describe("recibos de entrega e leitura", () => {
  it("marca como entregue a mensagem endereçada pelo id do provedor", async () => {
    const msg = await criarMensagem("MSG1");
    const res = await post(recibo("Delivered", ["MSG1"]));
    expect(res.statusCode).toBe(200);

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.status).toBe("delivered");
  });

  it("atualiza o lote inteiro — MessageIDs traz várias mensagens de uma vez", async () => {
    await criarMensagem("L1");
    await criarMensagem("L2");
    await criarMensagem("L3");

    await post(recibo("Read", ["L1", "L2", "L3"]));

    const lidas = await prisma.whatsappMessage.count({
      where: { organizationId: orgId, status: "read" },
    });
    expect(lidas).toBe(3);
  });

  it("nunca regride: recibo de entrega atrasado não desfaz uma leitura", async () => {
    const msg = await criarMensagem("R1", { status: "read" });

    await post(recibo("Delivered", ["R1"]));

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.status).toBe("read");
  });

  it("progride de sent para delivered e depois para read", async () => {
    const msg = await criarMensagem("P1", { status: "sent" });

    await post(recibo("Delivered", ["P1"]));
    expect((await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe(
      "delivered",
    );

    await post(recibo("Read", ["P1"]));
    expect((await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe(
      "read",
    );
  });

  it("leitura de mensagem recebida zera o não lido — o corretor leu no celular", async () => {
    await criarMensagem("I1", { direction: "inbound" });

    await post(recibo("Read", ["I1"]));

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.unreadCount).toBe(0);
  });

  it("entrega NÃO zera o não lido — entregue não é lido", async () => {
    await criarMensagem("I2", { direction: "inbound" });

    await post(recibo("Delivered", ["I2"]));

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.unreadCount).toBe(3);
  });

  it("ignora id desconhecido sem estourar", async () => {
    const res = await post(recibo("Read", ["NAO-EXISTE"]));
    expect(res.statusCode).toBe(200);
  });

  it("não atravessa organização", async () => {
    const outra = await signUpWithOrg(app, `status-b-${stamp}@eloscrm.test`, `status-b-${stamp}`);
    const outraInstancia = await prisma.uazapiInstance.create({
      data: {
        organizationId: outra.orgId,
        remoteId: `remote-status-b-${stamp}`,
        name: "outra",
        tokenEnc: "x.y.z",
        tokenHash: hashToken(`outro-${stamp}`),
        webhookSecret: `secret-b-${stamp}`,
      },
    });
    const outraConversa = await prisma.conversation.create({
      data: { organizationId: outra.orgId, instanceId: outraInstancia.id, chatid: CHATID },
    });
    const alheia = await prisma.whatsappMessage.create({
      data: {
        organizationId: outra.orgId,
        conversationId: outraConversa.id,
        providerId: "owner:X1",
        providerMessageId: "X1",
        direction: "outbound",
        type: "text",
        status: "sent",
        sentAt: new Date(),
      },
    });

    // o recibo chega pela instância da PRIMEIRA org, citando um id que existe na segunda
    await post(recibo("Read", ["X1"]));

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: alheia.id } });
    expect(salvo.status).toBe("sent");
  });

  it("recibo sem MessageIDs não quebra o webhook", async () => {
    const res = await post(recibo("Read", []));
    expect(res.statusCode).toBe(200);
  });
});
