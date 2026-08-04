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

// Envelope real observado no tráfego (§2.1/§2.5 do spec de conversas).
const evento = (message: Record<string, unknown>, chat: Record<string, unknown> = {}) => ({
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

describe("ingestão de mensagens", () => {
  it("normaliza o telefone: `chat.phone` vem com máscara, não com dígitos", async () => {
    // formato real observado em 2026-08-04 — a spec dizia "já normalizado, só dígitos", e não é
    await post(evento({ messageid: "MASK1", type: "text", text: "oi", content: "oi" }, {
      phone: "+55 43 9841-4904",
    }));

    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    // guardar com máscara faz o número virar destino de envio e quebra a busca por dígitos
    expect(conversa.phone).toBe("554398414904");
    expect(conversa.phoneKey).toBe("4398414904");
  });

  it("cria conversa e mensagem a partir do envelope real", async () => {
    const res = await post(
      evento({ messageid: "M1", type: "text", messageType: "Conversation", text: "oi", content: "oi" }),
    );
    expect(res.statusCode).toBe(200);

    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.chatid).toBe(CHATID);
    expect(conversa.phone).toBe("554398414904");
    // é o que casa com Client.phoneKey
    expect(conversa.phoneKey).toBe("4398414904");
    expect(conversa.unreadCount).toBe(1);
    expect(conversa.lastMessageText).toBe("oi");

    const msg = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId: conversa.id } });
    expect(msg.direction).toBe("inbound");
    expect(msg.type).toBe("text");
    expect(msg.text).toBe("oi");
    expect(msg.sentAt.getFullYear()).toBe(2026); // ms, não segundos: senão cairia em 1970
  });

  it("é idempotente — a reentrega do mesmo evento não duplica nem recontabiliza", async () => {
    const payload = evento({ messageid: "M2", type: "text", messageType: "Conversation", text: "olá" });
    await post(payload);
    await post(payload);

    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(1);
    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.unreadCount).toBe(1);
  });

  it("`content` string do texto simples não quebra a ingestão", async () => {
    const res = await post(
      evento({ messageid: "M3", type: "text", messageType: "Conversation", text: "teste", content: "teste" }),
    );
    expect(res.statusCode).toBe(200);
    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("guarda metadados e thumbnail da imagem direto do webhook", async () => {
    const res = await post(
      evento({
        messageid: "M4",
        type: "media",
        messageType: "ImageMessage",
        mediaType: "image",
        text: "legenda",
        content: {
          mimetype: "image/jpeg",
          fileLength: 18196,
          width: 520,
          height: 520,
          caption: "legenda",
          JPEGThumbnail: "/9j/4AAQSkZJRg==",
        },
      }),
    );
    // mídia que falha não pode virar 5xx: a uazapi reentregaria uma mensagem já gravada
    expect(res.statusCode).toBe(200);

    const msg = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(msg.type).toBe("image");
    expect(msg.mediaMime).toBe("image/jpeg");
    expect(msg.mediaSize).toBe(18196);
    expect(msg.mediaThumb).toBe("/9j/4AAQSkZJRg==");
    expect(msg.text).toBe("legenda");
    // tudo acima vem do próprio webhook e é o que a bolha mostra enquanto o arquivo não chega —
    // aqui ele nunca chega: sem Redis o download roda inline e o client da uazapi é um mock vazio.
    // O que importa é que a falha ficou registrada na mensagem, em vez de derrubar a ingestão.
    expect(msg.mediaStatus).toBe("failed");
    expect(msg.mediaError).toBeTruthy();
  });

  it("gif chega como VideoMessage mas é classificado por mediaType", async () => {
    await post(
      evento({
        messageid: "M5",
        type: "media",
        messageType: "VideoMessage",
        mediaType: "gif",
        content: { mimetype: "video/mp4", fileLength: 35509, seconds: 2, gifPlayback: true },
      }),
    );
    const msg = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(msg.type).toBe("gif");
    expect(msg.rawType).toBe("VideoMessage");
    expect(msg.mediaDuration).toBe(2);
  });

  it("áudio de voz vira ptt e guarda a waveform", async () => {
    await post(
      evento({
        messageid: "M6",
        type: "media",
        messageType: "AudioMessage",
        mediaType: "ptt",
        content: { mimetype: "audio/ogg; codecs=opus", fileLength: 12313, seconds: 5, waveform: "AAEC" },
      }),
    );
    const msg = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(msg.type).toBe("ptt");
    expect(msg.mediaWaveform).toBe("AAEC");
    expect(msg.mediaThumb).toBeNull(); // ptt não traz thumbnail
  });

  it("mensagem nossa não conta como não lida", async () => {
    await post(evento({ messageid: "M7", type: "text", messageType: "Conversation", text: "eu", fromMe: true }));
    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.unreadCount).toBe(0);
    const msg = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId: conversa.id } });
    expect(msg.direction).toBe("outbound");
  });

  it("nunca usa `sender` como telefone — ele é LID", async () => {
    await post(evento({ messageid: "M8", type: "text", messageType: "Conversation", text: "x" }));
    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.phone).not.toContain("@lid");
    expect(conversa.phone).not.toBe("226070083190831");
    expect(conversa.lid).toBe("53176141132007@lid");
  });
});

describe("vínculo com o lead", () => {
  it("vincula quando há um único lead com a mesma chave, mesmo sem o nono dígito", async () => {
    // no CRM o telefone tem 11 dígitos; no WhatsApp veio com 10
    const lead = await prisma.client.create({
      data: { organizationId: orgId, name: "Fulano", phone: "(43) 99841-4904", phoneKey: "4398414904" },
    });

    await post(evento({ messageid: "L1", type: "text", messageType: "Conversation", text: "oi" }));

    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.clientId).toBe(lead.id);
  });

  it("NÃO vincula quando dois leads respondem pela mesma chave", async () => {
    await prisma.client.createMany({
      data: [
        { organizationId: orgId, name: "Fixo", phone: "(43) 9841-4904", phoneKey: "4398414904" },
        { organizationId: orgId, name: "Celular", phone: "(43) 99841-4904", phoneKey: "4398414904" },
      ],
    });

    await post(evento({ messageid: "L2", type: "text", messageType: "Conversation", text: "oi" }));

    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    // atribuir ao lead errado é pior que deixar o corretor escolher
    expect(conversa.clientId).toBeNull();
  });

  it("não rouba conversa de lead de outra organização", async () => {
    const { orgId: outraOrg } = await signUpWithOrg(
      app,
      `ingest-outra-${stamp}@eloscrm.test`,
      `ingest-outra-${stamp}`,
    );
    await prisma.client.create({
      data: { organizationId: outraOrg, name: "De outra org", phone: "(43) 99841-4904", phoneKey: "4398414904" },
    });

    await post(evento({ messageid: "L3", type: "text", messageType: "Conversation", text: "oi" }));

    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.clientId).toBeNull();
  });
});
