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

/**
 * Contato compartilhado — os dois formatos, copiados do tráfego real de 2026-08-10.
 *
 * O provedor manda `mediaType: vcard` para um contato e `contact_array` para vários, e nos dois
 * casos `type: "media"`. Sem tratar, a mensagem caía em `unsupported`, ia para a fila de download e
 * voltava com "Message does not contain downloadable media" escrito na bolha do corretor.
 */
describe("contato compartilhado", () => {
  const VCARD_RYAN =
    "BEGIN:VCARD\nVERSION:3.0\nN:Varela;Ryan;;;\nFN:Ryan Varela\nX-WA-BIZ-NAME:Ryan\nTEL;waid=554399854972:+55 43 99985-4972\nEND:VCARD";
  const VCARD_JEREMIAS =
    "BEGIN:VCARD\nVERSION:3.0\nN:;Jeremias;;;\nFN:Jeremias\nX-WA-BIZ-NAME:Jeremias Matra\nX-WA-BIZ-DESCRIPTION:🚀 Atendimento Matra Tecnologia\n🔧 Sistemas | 📈 Tráfego Pago\nTEL;waid=554384778544:+55 43 98477-8544\nEND:VCARD";

  const mensagemSalva = () =>
    prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId } });

  it("um contato vira type contact, com nome e telefone", async () => {
    await post(
      evento({
        messageid: "CONTATO1",
        type: "media",
        mediaType: "vcard",
        messageType: "ContactMessage",
        text: "Ryan Varela\nX-Wa-Biz-Name: Ryan\nPhone: +55 43 99985-4972",
        content: { displayName: "Ryan Varela", vcard: VCARD_RYAN },
      }),
    );

    const salva = await mensagemSalva();
    expect(salva.type).toBe("contact");
    expect(salva.contacts).toEqual([
      { name: "Ryan Varela", phones: ["554399854972"], business: "Ryan" },
    ]);
  });

  it("não entra na fila de download — não há arquivo para baixar", async () => {
    await post(
      evento({
        messageid: "CONTATO2",
        type: "media",
        mediaType: "vcard",
        messageType: "ContactMessage",
        content: { displayName: "Ryan Varela", vcard: VCARD_RYAN },
      }),
    );

    const salva = await mensagemSalva();
    // era isto que produzia "Mídia indisponível" na bolha
    expect(salva.mediaStatus).toBe("none");
    expect(salva.mediaError).toBeNull();
  });

  it("vários contatos vêm todos, na ordem em que foram compartilhados", async () => {
    await post(
      evento({
        messageid: "CONTATO3",
        type: "media",
        mediaType: "contact_array",
        messageType: "ContactsArrayMessage",
        content: {
          displayName: "2 contatos",
          contacts: [
            { displayName: "Ryan Varela", vcard: VCARD_RYAN },
            { displayName: "Jeremias", vcard: VCARD_JEREMIAS },
          ],
        },
      }),
    );

    const salva = await mensagemSalva();
    expect(salva.type).toBe("contact");
    expect(salva.contacts).toEqual([
      { name: "Ryan Varela", phones: ["554399854972"], business: "Ryan" },
      { name: "Jeremias", phones: ["554384778544"], business: "Jeremias Matra" },
    ]);
  });

  it("a descrição comercial não entra no banco", async () => {
    await post(
      evento({
        messageid: "CONTATO4",
        type: "media",
        mediaType: "contact_array",
        messageType: "ContactsArrayMessage",
        content: { contacts: [{ displayName: "Jeremias", vcard: VCARD_JEREMIAS }] },
      }),
    );

    const salva = await mensagemSalva();
    // texto de propaganda, com emoji e quebras de linha, não cabe numa bolha nem ajuda a decidir
    expect(JSON.stringify(salva.contacts)).not.toContain("Tráfego Pago");
  });

  it("mensagem comum continua sem contatos", async () => {
    await post(evento({ messageid: "TEXTO1", type: "text", text: "oi", content: "oi" }));

    expect((await mensagemSalva()).contacts).toBeNull();
  });
});

/**
 * Localização — os dois formatos, do tráfego real de 2026-08-10.
 *
 * Também chega como `type: "media"` com `mediaType: location`, e sem tratamento caía em
 * `unsupported` com o `text` vazio: bolha em branco, só o horário. O mapa estático vem no
 * `JPEGThumbnail` do mesmo `content` e entra por `mediaThumb`, como o de foto e vídeo.
 */
describe("localização compartilhada", () => {
  const THUMB = "/9j/4AAQSkZJRgABAQAAAQABAAD/thumb-fake";

  const mensagemSalva = () =>
    prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId } });

  it("lugar traz nome, endereço e coordenadas", async () => {
    await post(
      evento({
        messageid: "LOCAL1",
        type: "media",
        mediaType: "location",
        messageType: "LocationMessage",
        text: "",
        content: {
          degreesLatitude: -23.28798522,
          degreesLongitude: -51.12338326,
          name: "Supermercado 88",
          address: "Av. das Maritacas, 1546 - Sl 20, Londrina, 86031-070, PR, BR",
          URL: "https://m.facebook.com/supermercado88/",
          JPEGThumbnail: THUMB,
        },
      }),
    );

    const salva = await mensagemSalva();
    expect(salva.type).toBe("location");
    expect(salva.location).toEqual({
      lat: -23.28798522,
      lng: -51.12338326,
      name: "Supermercado 88",
      address: "Av. das Maritacas, 1546 - Sl 20, Londrina, 86031-070, PR, BR",
      url: "https://m.facebook.com/supermercado88/",
    });
    // o mapa estático entra pelo mesmo caminho da miniatura de foto
    expect(salva.mediaThumb).toBe(THUMB);
  });

  it("ponto solto vem só com as coordenadas", async () => {
    await post(
      evento({
        messageid: "LOCAL2",
        type: "media",
        mediaType: "location",
        messageType: "LocationMessage",
        text: "",
        content: {
          degreesLatitude: -23.2900191,
          degreesLongitude: -51.1174595,
          JPEGThumbnail: THUMB,
        },
      }),
    );

    const salva = await mensagemSalva();
    expect(salva.type).toBe("location");
    expect(salva.location).toEqual({
      lat: -23.2900191,
      lng: -51.1174595,
      name: null,
      address: null,
      url: null,
    });
  });

  it("não entra na fila de download — mapa não é arquivo", async () => {
    await post(
      evento({
        messageid: "LOCAL3",
        type: "media",
        mediaType: "location",
        messageType: "LocationMessage",
        content: { degreesLatitude: -23.29, degreesLongitude: -51.11, JPEGThumbnail: THUMB },
      }),
    );

    const salva = await mensagemSalva();
    expect(salva.mediaStatus).toBe("none");
    expect(salva.mediaError).toBeNull();
  });

  it("coordenada zerada não vira localização — (0,0) é o meio do Atlântico", async () => {
    await post(
      evento({
        messageid: "LOCAL4",
        type: "media",
        mediaType: "location",
        messageType: "LocationMessage",
        content: { degreesLatitude: 0, degreesLongitude: 0 },
      }),
    );

    expect((await mensagemSalva()).location).toBeNull();
  });
});

/**
 * Enquete — os dois formatos do tráfego real de 2026-08-10.
 *
 * O tipo já era reconhecido (`type: "poll"` no envelope), mas as opções se perdiam: a bolha mostrava
 * só o `text`, que é a pergunta. `selectableOptionsCount` 1 é escolha única; 0 é o "pode marcar
 * várias" do WhatsApp.
 */
describe("enquete", () => {
  const mensagemSalva = () =>
    prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId } });

  const enquete = (
    nome: string,
    opcoes: string[],
    selectableOptionsCount: number,
    messageid: string,
  ) =>
    evento({
      messageid,
      type: "poll",
      mediaType: "",
      messageType: "PollCreationMessageV3",
      text: nome,
      convertOptions: opcoes.join("|"),
      content: {
        messageContextInfo: { deviceListMetadataVersion: 2 },
        pollCreationMessageV3: {
          name: nome,
          options: opcoes.map((optionName) => ({ optionName })),
          selectableOptionsCount,
        },
      },
    });

  it("escolha única guarda pergunta e opções na ordem", async () => {
    await post(enquete("Teste", ["Opção 1", "Opção 2"], 1, "POLL1"));

    const salva = await mensagemSalva();
    expect(salva.type).toBe("poll");
    expect(salva.poll).toEqual({
      name: "Teste",
      options: ["Opção 1", "Opção 2"],
      multiple: false,
    });
  });

  it("selectableOptionsCount 0 é múltipla escolha", async () => {
    await post(enquete("Teste 2", ["Opção 2", "Opção 1", "Opção 3"], 0, "POLL2"));

    const salva = await mensagemSalva();
    expect(salva.poll).toMatchObject({ options: ["Opção 2", "Opção 1", "Opção 3"], multiple: true });
  });

  it("sem o bloco da enquete, as opções saem do convertOptions", async () => {
    // o sufixo de `pollCreationMessageV3` é versão do protocolo; se mudar, o campo em texto sustenta
    await post(
      evento({
        messageid: "POLL3",
        type: "poll",
        messageType: "PollCreationMessageV9",
        text: "Qual horário?",
        convertOptions: "Manhã|Tarde",
        content: { messageContextInfo: {} },
      }),
    );

    expect((await mensagemSalva()).poll).toEqual({
      name: "Qual horário?",
      options: ["Manhã", "Tarde"],
      multiple: true,
    });
  });

  it("enquete sem opção nenhuma não vira cartão vazio", async () => {
    await post(
      evento({ messageid: "POLL4", type: "poll", text: "Sem opções", content: {} }),
    );

    expect((await mensagemSalva()).poll).toBeNull();
  });
});

/**
 * Voto em enquete (`PollUpdateMessage`), do tráfego real de 2026-08-10.
 *
 * Chega com `type: "poll"` e sem texto, então virava bolha própria — e, sem texto nem mídia, ainda
 * caía no cartão genérico de arquivo na tela. O voto pertence à enquete, como a reação pertence à
 * bolha que recebeu o emoji.
 */
describe("voto em enquete", () => {
  const POLL_ID = "AC354AA0AA0FA34E0F4706AD26254C13";

  const criarEnquete = () =>
    post(
      evento({
        messageid: POLL_ID,
        type: "poll",
        messageType: "PollCreationMessageV3",
        text: "Enquete 1",
        convertOptions: "Opção 1|Opção 2|Opção 3",
        content: {
          pollCreationMessageV3: {
            name: "Enquete 1",
            options: [{ optionName: "Opção 1" }, { optionName: "Opção 2" }, { optionName: "Opção 3" }],
            selectableOptionsCount: 0,
          },
        },
      }),
    );

  const votar = (choice: string, messageid: string, senderName = "Bruno Zielinski") =>
    post(
      evento({
        messageid,
        type: "poll",
        mediaType: "",
        messageType: "PollUpdateMessage",
        text: "",
        vote: choice,
        senderName,
        quoted: POLL_ID,
        content: {
          pollCreationMessageKey: { remoteJID: "226070083190831@lid", fromMe: true, ID: POLL_ID },
          vote: { encPayload: "eHTVAxpQ9u9j", encIV: "87ZpEeSdPV664" },
          metadata: { pollNameHash: "MkDL4GCWnstD63ZS" },
        },
      }),
    );

  const enquete = () =>
    prisma.whatsappMessage.findFirstOrThrow({
      where: { organizationId: orgId, providerMessageId: POLL_ID },
    });

  it("o voto não vira mensagem na thread", async () => {
    await criarEnquete();
    await votar("Opção 1", "VOTO1");

    // só a enquete: o voto foi para dentro dela
    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("o voto entra na enquete, com quem votou", async () => {
    await criarEnquete();
    await votar("Opção 1", "VOTO2");

    expect((await enquete()).poll).toMatchObject({
      name: "Enquete 1",
      votes: [{ choices: ["Opção 1"], voterName: "Bruno Zielinski" }],
    });
  });

  it("trocar de opção substitui o voto, não acumula", async () => {
    await criarEnquete();
    await votar("Opção 1", "VOTO3");
    await votar("Opção 3", "VOTO4");

    const poll = (await enquete()).poll as { votes: { choices: string[] }[] };
    expect(poll.votes).toHaveLength(1);
    expect(poll.votes[0]!.choices).toEqual(["Opção 3"]);
  });

  it("votos de pessoas diferentes convivem", async () => {
    await criarEnquete();
    await votar("Opção 1", "VOTO5");
    await post(
      evento(
        {
          messageid: "VOTO6",
          type: "poll",
          messageType: "PollUpdateMessage",
          text: "",
          vote: "Opção 2",
          senderName: "Outra Pessoa",
          sender_lid: "999999@lid",
          quoted: POLL_ID,
          content: { pollCreationMessageKey: { ID: POLL_ID } },
        },
      ),
    );

    const poll = (await enquete()).poll as { votes: { choices: string[] }[] };
    expect(poll.votes).toHaveLength(2);
  });

  it("múltipla escolha vem com todas as opções marcadas, separadas por vírgula", async () => {
    await criarEnquete();
    await votar("Opção 1", "VOTOM1");
    // o provedor reenvia o estado completo, não só a opção nova
    await votar("Opção 1, Opção 2", "VOTOM2");

    const poll = (await enquete()).poll as { votes: { choices: string[] }[] };
    expect(poll.votes).toHaveLength(1);
    expect(poll.votes[0]!.choices).toEqual(["Opção 1", "Opção 2"]);
  });

  it("desmarcar uma opção reduz o voto ao que sobrou", async () => {
    await criarEnquete();
    await votar("Opção 1, Opção 2", "VOTOM3");
    await votar("Opção 2", "VOTOM4");

    const poll = (await enquete()).poll as { votes: { choices: string[] }[] };
    expect(poll.votes[0]!.choices).toEqual(["Opção 2"]);
  });

  it("opção com vírgula no nome não é dividida ao meio", async () => {
    await post(
      evento({
        messageid: "POLLV",
        type: "poll",
        messageType: "PollCreationMessageV3",
        text: "Confirma?",
        content: {
          pollCreationMessageV3: {
            name: "Confirma?",
            options: [{ optionName: "Sim, quero" }, { optionName: "Não" }],
            selectableOptionsCount: 1,
          },
        },
      }),
    );
    await post(
      evento({
        messageid: "VOTOV",
        type: "poll",
        messageType: "PollUpdateMessage",
        text: "",
        vote: "Sim, quero",
        quoted: "POLLV",
        content: { pollCreationMessageKey: { ID: "POLLV" } },
      }),
    );

    const salva = await prisma.whatsappMessage.findFirstOrThrow({
      where: { organizationId: orgId, providerMessageId: "POLLV" },
    });
    expect((salva.poll as { votes: { choices: string[] }[] }).votes[0]!.choices).toEqual([
      "Sim, quero",
    ]);
  });

  it("desmarcar tudo tira o voto da enquete, sem virar bolha", async () => {
    await criarEnquete();
    await votar("Opção 1, Opção 2", "VOTOD1");
    // desmarcar chega com o voto vazio, e continua sendo evento de voto
    await votar("", "VOTOD2");

    const poll = (await enquete()).poll as { votes: unknown[] };
    expect(poll.votes).toEqual([]);
    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("resposta de texto citando a enquete continua sendo mensagem", async () => {
    await criarEnquete();
    // o `quoted` sozinho não faz um voto: sem `pollCreationMessageKey` isto é uma resposta comum
    await post(
      evento({
        messageid: "RESPOSTA1",
        type: "text",
        text: "Prefiro a primeira",
        content: "Prefiro a primeira",
        quoted: POLL_ID,
      }),
    );

    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("voto em enquete que não temos é ignorado, sem virar bolha", async () => {
    await votar("Opção 1", "VOTO7");

    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("a referência à enquete não é confundida com a criação de uma", async () => {
    await criarEnquete();
    await votar("Opção 1", "VOTO8");

    // `pollCreationMessageKey` começa com o mesmo prefixo do bloco de criação
    const votos = await prisma.whatsappMessage.findMany({
      where: { organizationId: orgId, providerMessageId: "VOTO8" },
    });
    expect(votos).toHaveLength(0);
  });
});
