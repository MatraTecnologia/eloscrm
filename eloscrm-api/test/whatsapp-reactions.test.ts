import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

const remote = { messages: { react: vi.fn() } };
vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => remote }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let instanceId = "";
let conversationId = "";
const SECRET = `segredo-react-${stamp}`;
const TOKEN = `tok-react-${stamp}`;
const CHATID = "554398414904@s.whatsapp.net";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `react-${stamp}@eloscrm.test`, `react-${stamp}`));
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-react-${stamp}`,
      name: "react",
      tokenEnc: encryptToken(TOKEN),
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

let seq = 0;
beforeEach(async () => {
  vi.clearAllMocks();
  remote.messages.react.mockResolvedValue({ success: true, data: { messageid: "R1" } });
  await prisma.whatsappMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      instanceId,
      chatid: CHATID,
      phone: "554398414904",
      lastMessageAt: new Date(),
      lastMessageText: "oi",
      unreadCount: 2,
    },
  });
  conversationId = conversation.id;
});

const criarMensagem = (data: Record<string, unknown> = {}) =>
  prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `owner:M${seq}`,
      providerMessageId: `M${seq++}`,
      direction: "inbound",
      type: "text",
      status: "sent",
      text: "quanto custa?",
      sentAt: new Date(),
      ...data,
    },
  });

// Envelope real de reação, capturado em 2026-08-04.
const eventoReacao = (alvo: string, emoji: string, extra: Record<string, unknown> = {}) => ({
  EventType: "messages",
  token: TOKEN,
  owner: "554391834229",
  instanceName: "react",
  chat: { wa_chatid: CHATID, phone: "554398414904", wa_isGroup: false },
  message: {
    id: `554391834229:REACT${seq}`,
    messageid: `REACT${seq++}`,
    chatid: CHATID,
    sender_pn: "554398414904@s.whatsapp.net",
    sender_lid: "53176141132007@lid",
    senderName: "Bruno",
    fromMe: false,
    type: "reaction",
    messageType: "ReactionMessage",
    text: emoji,
    reaction: alvo,
    content: { key: { ID: alvo, fromMe: true }, text: emoji },
    messageTimestamp: 1785860646000,
    ...extra,
  },
});

const post = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/webhooks/uazapi/${instanceId}/${SECRET}`, payload: body });

const thread = async () => {
  const res = await app.inject({
    method: "GET",
    url: `/v1/whatsapp/conversations/${conversationId}/messages`,
    headers: { cookie },
  });
  return res.json();
};

describe("reação recebida", () => {
  it("gruda na bolha do alvo em vez de virar mensagem na thread", async () => {
    const alvo = await criarMensagem({ direction: "outbound", text: "R$ 450 mil" });

    const res = await post(eventoReacao(alvo.providerMessageId!, "😮"));
    expect(res.statusCode).toBe(200);

    const { items } = await thread();
    // uma bolha só: a reação não entra na conversa como mensagem
    expect(items).toHaveLength(1);
    expect(items[0].reactions).toEqual([
      { emoji: "😮", mine: false, authorName: "Bruno" },
    ]);
  });

  it("trocar de emoji substitui, não acumula", async () => {
    const alvo = await criarMensagem();

    await post(eventoReacao(alvo.providerMessageId!, "😮"));
    await post(eventoReacao(alvo.providerMessageId!, "👍"));

    const { items } = await thread();
    // o provedor garante uma reação ativa por pessoa e por mensagem
    expect(items[0].reactions).toHaveLength(1);
    expect(items[0].reactions[0].emoji).toBe("👍");
  });

  it("emoji vazio remove a reação", async () => {
    const alvo = await criarMensagem();
    await post(eventoReacao(alvo.providerMessageId!, "👍"));

    await post(eventoReacao(alvo.providerMessageId!, ""));

    const { items } = await thread();
    expect(items[0].reactions).toEqual([]);
  });

  it("não mexe na prévia nem no não lido — reagir não é escrever", async () => {
    const alvo = await criarMensagem();

    await post(eventoReacao(alvo.providerMessageId!, "❤️"));

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.lastMessageText).toBe("oi");
    expect(conversa.unreadCount).toBe(2);
  });

  it("alvo desconhecido é ignorado sem derrubar o webhook", async () => {
    const res = await post(eventoReacao("NAO-EXISTE", "👍"));

    expect(res.statusCode).toBe(200);
    expect(await prisma.whatsappReaction.count()).toBe(0);
  });

  it("reação minha pelo celular e pelo CRM não viram duas linhas", async () => {
    const alvo = await criarMensagem();
    // pelo celular: chega com fromMe e com o LID da própria instância
    await post(
      eventoReacao(alvo.providerMessageId!, "👍", {
        fromMe: true,
        sender_lid: "226070083190831@lid",
      }),
    );
    await post(
      eventoReacao(alvo.providerMessageId!, "❤️", {
        fromMe: true,
        sender_lid: "226070083190831@lid",
      }),
    );

    const { items } = await thread();
    expect(items[0].reactions).toHaveLength(1);
    expect(items[0].reactions[0].mine).toBe(true);
  });
});

describe("POST /:id/messages/:messageId/reaction", () => {
  const reagir = (messageId: string, emoji: string) =>
    app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}/reaction`,
      headers: { cookie },
      payload: { emoji },
    });

  it("manda o emoji e o id do provedor para a uazapi", async () => {
    const alvo = await criarMensagem();

    const res = await reagir(alvo.id, "👍");
    expect(res.statusCode).toBe(200);
    expect(remote.messages.react).toHaveBeenCalledWith({
      number: "554398414904",
      text: "👍",
      id: alvo.providerMessageId,
    });

    const { items } = await thread();
    expect(items[0].reactions[0]).toMatchObject({ emoji: "👍", mine: true });
  });

  it("emoji vazio remove", async () => {
    const alvo = await criarMensagem();
    await reagir(alvo.id, "👍");

    await reagir(alvo.id, "");

    const { items } = await thread();
    expect(items[0].reactions).toEqual([]);
  });

  it("recusa reagir à própria mensagem — o provedor não permite", async () => {
    const minha = await criarMensagem({ direction: "outbound" });

    const res = await reagir(minha.id, "👍");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MESSAGE_NOT_REACTABLE");
    expect(remote.messages.react).not.toHaveBeenCalled();
  });

  it("não reage a mensagem de outra conversa", async () => {
    const outra = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `outra-${seq++}@s.whatsapp.net` },
    });
    const alheia = await prisma.whatsappMessage.create({
      data: {
        organizationId: orgId,
        conversationId: outra.id,
        providerId: `owner:ALHEIA${seq}`,
        providerMessageId: `ALHEIA${seq++}`,
        direction: "inbound",
        type: "text",
        status: "sent",
        sentAt: new Date(),
      },
    });

    const res = await reagir(alheia.id, "👍");
    expect(res.statusCode).toBe(404);
  });

  it("falha do provedor não grava a reação", async () => {
    const alvo = await criarMensagem();
    remote.messages.react.mockResolvedValue({
      success: false,
      error: { status: 500, error: "boom" },
    });

    const res = await reagir(alvo.id, "👍");
    expect(res.statusCode).toBe(502);
    // reação que aparece e some é pior que meio segundo de espera
    expect(await prisma.whatsappReaction.count()).toBe(0);
  });
});
