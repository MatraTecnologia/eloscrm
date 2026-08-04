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
let cookie = "";
let instanceId = "";
let conversationId = "";
const SECRET = `segredo-status-${stamp}`;
const TOKEN = `tok-status-${stamp}`;
const CHATID = `554398414904@s.whatsapp.net`;

beforeAll(async () => {
  app = await makeApp();
  ({ orgId, cookie } = await signUpWithOrg(app, `status-${stamp}@eloscrm.test`, `status-${stamp}`));
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

// a thread pela API, que é onde se vê o que o front realmente recebe
const listarMensagens = async () => {
  const res = await app.inject({
    method: "GET",
    url: `/v1/whatsapp/conversations/${conversationId}/messages`,
    headers: { cookie },
  });
  return res.json();
};

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

// Payload real de 2026-08-04: "apagar para todos" vem no MESMO messages_update dos recibos.
const delecao = (ids: string[]) => ({
  ...recibo("Deleted", ids),
  type: "DeletedMessage",
});

describe("mensagem apagada no WhatsApp", () => {
  it("marca como apagada e para de servir o conteúdo", async () => {
    const msg = await criarMensagem("DEL1", { text: "esta some", direction: "inbound" });

    const res = await post(delecao(["DEL1"]));
    expect(res.statusCode).toBe(200);

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.deletedAt).not.toBeNull();
    // o registro fica no banco — quem esconde é a API, ao serializar
    expect(salvo.text).toBe("esta some");
  });

  it("some com o texto na resposta da API, não só na tela", async () => {
    await criarMensagem("DEL2", { text: "conteúdo apagado", direction: "inbound" });
    await post(delecao(["DEL2"]));

    const { items } = await listarMensagens();
    const apagada = items.find((m: { quotedId: string | null; deletedAt: string | null }) => m.deletedAt);
    expect(apagada.text).toBeNull();
    expect(apagada.mediaThumb).toBeNull();
    expect(apagada.mediaUrl).toBeNull();
  });

  it("limpa a prévia da conversa quando a última mensagem é apagada", async () => {
    await criarMensagem("DEL3", { text: "última", direction: "inbound" });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageText: "última" },
    });

    await post(delecao(["DEL3"]));

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    // sem isto a lista continuaria mostrando o texto que a thread já não mostra
    expect(conversa.lastMessageText).toBeNull();
  });

  it("desconta do não lido — conversa não fica acesa por mensagem que sumiu", async () => {
    await criarMensagem("DEL4", { direction: "inbound" });

    // a conversa nasce com 3 no beforeEach
    await post(delecao(["DEL4"]));

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.unreadCount).toBe(2);
  });

  it("reconhece a deleção pelo event.Type quando `state` não vem", async () => {
    const msg = await criarMensagem("DEL5", { direction: "inbound" });
    // a mesma leitura de dupla fonte que causou o incidente do 422: os dois caminhos precisam valer
    const { state: _state, ...semState } = delecao(["DEL5"]);

    await post(semState);

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.deletedAt).not.toBeNull();
  });

  it("não apaga mensagem de outra organização", async () => {
    const outra = await signUpWithOrg(app, `del-b-${stamp}@eloscrm.test`, `del-b-${stamp}`);
    const outraInstancia = await prisma.uazapiInstance.create({
      data: {
        organizationId: outra.orgId,
        remoteId: `remote-del-b-${stamp}`,
        name: "del-b",
        tokenEnc: "x.y.z",
        tokenHash: hashToken(`tok-del-b-${stamp}`),
        webhookSecret: `secret-del-b-${stamp}`,
      },
    });
    const outraConversa = await prisma.conversation.create({
      data: { organizationId: outra.orgId, instanceId: outraInstancia.id, chatid: CHATID },
    });
    const alheia = await prisma.whatsappMessage.create({
      data: {
        organizationId: outra.orgId,
        conversationId: outraConversa.id,
        providerId: "owner:DELX",
        providerMessageId: "DELX",
        direction: "inbound",
        type: "text",
        status: "sent",
        sentAt: new Date(),
      },
    });

    await post(delecao(["DELX"]));

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: alheia.id } });
    expect(salvo.deletedAt).toBeNull();
  });
});
