import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

const remote = { messages: { delete: vi.fn(), pin: vi.fn() } };
vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => remote }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let instanceId = "";
let conversationId = "";
const TOKEN = `tok-acoes-${stamp}`;

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `acoes-${stamp}@eloscrm.test`, `acoes-${stamp}`));
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-acoes-${stamp}`,
      name: "acoes",
      tokenEnc: encryptToken(TOKEN),
      tokenHash: hashToken(TOKEN),
      webhookSecret: `secret-acoes-${stamp}`,
      status: "connected",
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
  vi.clearAllMocks();
  remote.messages.delete.mockResolvedValue({ success: true, data: { id: "D1" } });
  remote.messages.pin.mockResolvedValue({ success: true, data: { messageid: "P1" } });
  await prisma.whatsappMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      instanceId,
      chatid: `55439999${seq++}@s.whatsapp.net`,
      phone: "554399990000",
    },
  });
  conversationId = conversation.id;
});

const criarMensagem = (data: Record<string, unknown> = {}) =>
  prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `owner:A${seq}`,
      providerMessageId: `A${seq++}`,
      direction: "outbound",
      type: "text",
      status: "sent",
      text: "combinado",
      sentAt: new Date(),
      ...data,
    },
  });

const acao = (messageId: string, sufixo: string, payload?: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}/${sufixo}`,
    headers: { cookie },
    payload,
  });

const apagar = (messageId: string) =>
  app.inject({
    method: "DELETE",
    url: `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}`,
    headers: { cookie },
  });

const thread = async () => {
  const res = await app.inject({
    method: "GET",
    url: `/v1/whatsapp/conversations/${conversationId}/messages`,
    headers: { cookie },
  });
  return res.json();
};

describe("apagar mensagem", () => {
  it("apaga no provedor e esconde o conteúdo", async () => {
    const msg = await criarMensagem();

    const res = await apagar(msg.id);
    expect(res.statusCode).toBe(200);
    expect(remote.messages.delete).toHaveBeenCalledWith({ id: msg.providerMessageId });

    const { items } = await thread();
    expect(items[0].deletedAt).not.toBeNull();
    // mesma política da deleção recebida: oculta na API, preservada no banco
    expect(items[0].text).toBeNull();
    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.text).toBe("combinado");
  });

  it("limpa a prévia da lista quando a apagada era a última", async () => {
    const msg = await criarMensagem({ text: "combinado" });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageText: "combinado", lastMessageAt: msg.sentAt },
    });

    await apagar(msg.id);

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    // o eco do provedor não conserta: applyDeletion filtra `deletedAt: null` e a mensagem já foi
    // marcada aqui. Sem recalcular, a lista mostraria o texto que a thread esconde.
    expect(conversa.lastMessageText).toBeNull();
  });

  it("recusa apagar mensagem do lead — apagaria registro de negociação", async () => {
    const recebida = await criarMensagem({ direction: "inbound" });

    const res = await apagar(recebida.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MESSAGE_NOT_DELETABLE");
    expect(remote.messages.delete).not.toHaveBeenCalled();
  });

  it("apagar de novo não chama o provedor outra vez", async () => {
    const msg = await criarMensagem({ deletedAt: new Date() });

    const res = await apagar(msg.id);
    expect(res.statusCode).toBe(200);
    expect(remote.messages.delete).not.toHaveBeenCalled();
  });

  it("falha do provedor não marca como apagada", async () => {
    const msg = await criarMensagem();
    remote.messages.delete.mockResolvedValue({
      success: false,
      error: { status: 400, error: "too old" },
    });

    const res = await apagar(msg.id);
    expect(res.statusCode).toBe(502);
    // sumir daqui e continuar no aparelho do lead seria mentira na tela
    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.deletedAt).toBeNull();
  });
});

describe("fixar mensagem", () => {
  const pinned = async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/whatsapp/conversations/${conversationId}/pinned`,
      headers: { cookie },
    });
    return res.json();
  };

  it("fixa com a duração escolhida e aparece na barra do topo", async () => {
    const msg = await criarMensagem();

    const res = await acao(msg.id, "pin", { pin: true, duration: 7 });
    expect(res.statusCode).toBe(200);
    expect(remote.messages.pin).toHaveBeenCalledWith({
      id: msg.providerMessageId,
      pin: true,
      duration: 7,
    });

    expect(await pinned()).toHaveLength(1);
  });

  it("pin expirado some da barra — o provedor não avisa quando acaba", async () => {
    const msg = await criarMensagem();
    await acao(msg.id, "pin", { pin: true, duration: 1 });
    await prisma.whatsappMessage.update({
      where: { id: msg.id },
      data: { pinnedUntil: new Date(Date.now() - 1000) },
    });

    expect(await pinned()).toHaveLength(0);
  });

  it("desafixar não manda duração", async () => {
    const msg = await criarMensagem({ pinnedAt: new Date(), pinnedUntil: new Date(Date.now() + 1e6) });

    await acao(msg.id, "pin", { pin: false });

    expect(remote.messages.pin).toHaveBeenCalledWith({ id: msg.providerMessageId, pin: false });
    expect(await pinned()).toHaveLength(0);
  });

  it("duração fora de 1/7/30 é recusada antes de chamar o provedor", async () => {
    const msg = await criarMensagem();

    const res = await acao(msg.id, "pin", { pin: true, duration: 15 });
    // o provedor trocaria por 30 em silêncio, e a barra mostraria uma validade que não é a pedida
    expect(res.statusCode).toBe(422);
    expect(remote.messages.pin).not.toHaveBeenCalled();
  });

  it("mensagem apagada não entra na barra", async () => {
    const msg = await criarMensagem({
      pinnedAt: new Date(),
      pinnedUntil: new Date(Date.now() + 1e6),
      deletedAt: new Date(),
    });
    void msg;

    expect(await pinned()).toHaveLength(0);
  });
});

describe("fixar pelo celular (eco do webhook)", () => {
  // Payload real de 2026-08-04: fixar fora do CRM volta como `messages_update`, com
  // `type: "PinnedMessage"` e `state: "Pinned"/"Unpinned"` — não como mensagem na thread.
  const eventoPin = (ids: string[], state: "Pinned" | "Unpinned") => ({
    EventType: "messages_update",
    type: "PinnedMessage",
    state,
    token: TOKEN,
    owner: "554391834229",
    instanceName: "acoes",
    event: {
      Chat: "554398414904@s.whatsapp.net",
      MessageIDs: ids,
      Pinned: state === "Pinned",
      Type: state,
      // ⚠️ ISO-8601 aqui, enquanto o ReadReceipt manda epoch em segundos
      Timestamp: "2026-08-04T17:21:29Z",
      sender_lid: "53176141132007@lid",
    },
  });

  const postWebhook = async (body: Record<string, unknown>) => {
    const instance = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    return app.inject({
      method: "POST",
      url: `/webhooks/uazapi/${instanceId}/${instance.webhookSecret}`,
      payload: body,
    });
  };

  it("fixar no aparelho reflete na barra do CRM", async () => {
    const msg = await criarMensagem();

    const res = await postWebhook(eventoPin([msg.providerMessageId!], "Pinned"));
    expect(res.statusCode).toBe(200);

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.pinnedAt).not.toBeNull();
    // o evento não traz duração; sem um `pinnedUntil` a barra ignoraria o pin feito pelo celular
    expect(salvo.pinnedUntil).not.toBeNull();
  });

  it("desafixar no aparelho tira da barra", async () => {
    const msg = await criarMensagem({
      pinnedAt: new Date(),
      pinnedUntil: new Date(Date.now() + 1e6),
    });

    await postWebhook(eventoPin([msg.providerMessageId!], "Unpinned"));

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.pinnedUntil).toBeNull();
  });

  it("id desconhecido não quebra o webhook", async () => {
    const res = await postWebhook(eventoPin(["NAO-EXISTE"], "Pinned"));
    expect(res.statusCode).toBe(200);
  });
});

describe("favoritar mensagem", () => {
  it("marca sem falar com o provedor — é marca do CRM", async () => {
    const msg = await criarMensagem();

    const res = await acao(msg.id, "favorite", { favorite: true });
    expect(res.statusCode).toBe(200);

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.favoritedAt).not.toBeNull();
    expect(salvo.favoritedById).not.toBeNull();
  });

  it("funciona com o WhatsApp desconectado — não depende do provedor", async () => {
    await prisma.uazapiInstance.update({
      where: { id: instanceId },
      data: { status: "disconnected" },
    });
    const msg = await criarMensagem();

    const res = await acao(msg.id, "favorite", { favorite: true });
    expect(res.statusCode).toBe(200);

    await prisma.uazapiInstance.update({
      where: { id: instanceId },
      data: { status: "connected" },
    });
  });

  it("desfavoritar limpa quem marcou", async () => {
    const msg = await criarMensagem();
    await acao(msg.id, "favorite", { favorite: true });

    await acao(msg.id, "favorite", { favorite: false });

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.favoritedAt).toBeNull();
    expect(salvo.favoritedById).toBeNull();
  });

  it("não age sobre mensagem de outra conversa", async () => {
    const outra = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `outra-${seq++}@s.whatsapp.net` },
    });
    const alheia = await prisma.whatsappMessage.create({
      data: {
        organizationId: orgId,
        conversationId: outra.id,
        providerId: `owner:X${seq}`,
        providerMessageId: `X${seq++}`,
        direction: "outbound",
        type: "text",
        status: "sent",
        sentAt: new Date(),
      },
    });

    const res = await acao(alheia.id, "favorite", { favorite: true });
    expect(res.statusCode).toBe(404);
  });
});
