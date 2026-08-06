import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

const remote = { send: { text: vi.fn() } };
vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => remote }));

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
      // cifrado de verdade: o envio descriptografa antes de falar com a uazapi
      tokenEnc: encryptToken(`tok-conv-${stamp}`),
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
  // os testes de vínculo criam leads com a mesma phoneKey; sem limpar, um contamina a contagem
  // de candidatos do outro
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
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

describe("GET /v1/whatsapp/conversations/counts", () => {
  it("conta por aba: todas são as não arquivadas", async () => {
    // o beforeEach cria uma com unreadCount 2
    await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `lida-c-${stamp}@s.whatsapp.net`, unreadCount: 0 },
    });
    await prisma.conversation.create({
      data: {
        organizationId: orgId,
        instanceId,
        chatid: `arq-c-${stamp}@s.whatsapp.net`,
        unreadCount: 5,
        archivedAt: new Date(),
      },
    });

    const counts = (await get("/v1/whatsapp/conversations/counts")).json();
    expect(counts).toEqual({ all: 2, unread: 1, archived: 1 });
  });

  it("não conta conversa de outra imobiliária", async () => {
    const counts = (await get("/v1/whatsapp/conversations/counts", cookieB)).json();
    expect(counts).toEqual({ all: 0, unread: 0, archived: 0 });
  });

  it("`counts` não é lido como id de conversa", async () => {
    // a rota curinga `/:id` capturaria a palavra se fosse registrada antes
    const res = await get("/v1/whatsapp/conversations/counts");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("all");
  });
});

describe("GET /v1/whatsapp/conversations/:id/messages", () => {
  it("devolve em ordem cronológica, do mais antigo para o mais novo", async () => {
    await criarMensagem({ text: "primeira", sentAt: new Date("2026-08-01T10:00:00Z") });
    await criarMensagem({ text: "segunda", sentAt: new Date("2026-08-01T11:00:00Z") });

    const { items } = (await get(`/v1/whatsapp/conversations/${conversationId}/messages`)).json();
    expect(items.map((m: { text: string }) => m.text)).toEqual(["primeira", "segunda"]);
  });

  it("resolve a prévia da mensagem citada pelo id do provedor", async () => {
    await criarMensagem({ providerMessageId: "ORIG1", text: "quanto custa?", senderName: "Fulano" });
    await criarMensagem({ text: "R$ 450 mil", quotedId: "ORIG1" });

    const { items } = (await get(`/v1/whatsapp/conversations/${conversationId}/messages`)).json();
    const resposta = items.find((m: { quotedId: string | null }) => m.quotedId === "ORIG1");
    expect(resposta.quoted.text).toBe("quanto custa?");
    expect(resposta.quoted.senderName).toBe("Fulano");
    // a prévia não assina URL de mídia: quem cita já tem a miniatura no próprio registro
    expect(resposta.quoted).not.toHaveProperty("mediaUrl");
  });

  it("citada fora do alcance devolve quoted nulo, sem derrubar a thread", async () => {
    await criarMensagem({ text: "respondendo algo antigo", quotedId: "ANTES-DA-INTEGRACAO" });

    const { items } = (await get(`/v1/whatsapp/conversations/${conversationId}/messages`)).json();
    expect(items[0].quotedId).toBe("ANTES-DA-INTEGRACAO");
    expect(items[0].quoted).toBeNull();
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

describe("POST /v1/whatsapp/conversations/:id/messages", () => {
  const enviar = (payload: Record<string, unknown>, c = cookie) =>
    app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/messages`,
      headers: { cookie: c },
      payload,
    });

  const conectar = () =>
    prisma.uazapiInstance.update({ where: { id: instanceId }, data: { status: "connected" } });

  beforeEach(() => {
    vi.clearAllMocks();
    remote.send.text.mockResolvedValue({
      success: true,
      data: { id: "554391834229:ENVIADA1", messageid: "ENVIADA1", status: "Pending" },
    });
  });

  it("envia e guarda o id que a uazapi devolveu", async () => {
    await conectar();
    const res = await enviar({ text: "Bom dia! Já retorno com os valores." });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.direction).toBe("outbound");
    expect(body.status).toBe("sent");
    expect(body.providerId).toBe("554391834229:ENVIADA1");
    expect(body.text).toBe("Bom dia! Já retorno com os valores.");

    expect(remote.send.text).toHaveBeenCalledWith({
      number: "554399990000",
      text: "Bom dia! Já retorno com os valores.",
    });
  });

  it("responde citando: manda replyid ao provedor e guarda o vínculo", async () => {
    await conectar();
    const citada = await criarMensagem({ providerMessageId: "CITADA1", text: "tem garagem?" });

    const res = await enviar({ text: "Tem, para dois carros.", replyToId: citada.id });
    expect(res.statusCode).toBe(201);
    // o front manda o nosso cuid; quem traduz para o id do provedor é o serviço
    expect(remote.send.text).toHaveBeenCalledWith({
      number: "554399990000",
      text: "Tem, para dois carros.",
      replyid: "CITADA1",
    });
    expect(res.json().quoted.text).toBe("tem garagem?");
  });

  it("não deixa citar mensagem de outra conversa", async () => {
    await conectar();
    const outra = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `outra-${seq++}@s.whatsapp.net` },
    });
    const alheia = await prisma.whatsappMessage.create({
      data: {
        organizationId: orgId,
        conversationId: outra.id,
        providerId: `owner:ALHEIA${seq++}`,
        providerMessageId: `ALHEIA${seq}`,
        direction: "inbound",
        type: "text",
        status: "sent",
        sentAt: new Date(),
      },
    });

    const res = await enviar({ text: "citando o chat errado", replyToId: alheia.id });
    expect(res.statusCode).toBe(404);
    expect(remote.send.text).not.toHaveBeenCalled();
  });

  it("recusa citar mensagem que ainda não tem id no provedor", async () => {
    await conectar();
    const pendente = await criarMensagem({ providerMessageId: null, status: "pending" });

    const res = await enviar({ text: "citando pendente", replyToId: pendente.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MESSAGE_NOT_REPLIABLE");
  });

  it("atualiza a prévia da conversa na lista", async () => {
    await conectar();
    await enviar({ text: "prévia nova" });
    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.lastMessageText).toBe("prévia nova");
  });

  it("falha do provedor deixa a mensagem na thread, marcada como failed", async () => {
    await conectar();
    remote.send.text.mockResolvedValue({ success: false, error: { status: 500, error: "boom" } });

    const citada = await criarMensagem({ providerMessageId: "FALHA1" });
    const res = await enviar({ text: "não vai sair", replyToId: citada.id });
    expect(res.statusCode).toBe(502);

    // a mensagem não some entre o clique e o erro — o corretor vê o que tentou mandar
    const msg = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId, text: "não vai sair" },
    });
    expect(msg.status).toBe("failed");
    // a citação também fica: a bolha de erro mostra a tentativa inteira, não metade dela
    expect(msg.quotedId).toBe("FALHA1");
  });

  it("bloqueio do WhatsApp tem código próprio, distinto de falha da conexão", async () => {
    await conectar();
    remote.send.text.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        error: "blocked",
        error_source: "whatsapp_server",
        provider_code: 463,
        message_ptbr: "Limite de novas conversas atingido",
      },
    });

    const res = await enviar({ text: "primeira mensagem para este número" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("WHATSAPP_BLOCKED");
    expect(res.json().error.message).toBe("Limite de novas conversas atingido");
    expect(res.json().error.details).toEqual({ providerCode: 463 });
  });

  it("recusa envio com a instância desconectada, sem chamar a uazapi", async () => {
    await prisma.uazapiInstance.update({ where: { id: instanceId }, data: { status: "disconnected" } });

    const res = await enviar({ text: "oi" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INSTANCE_NOT_CONNECTED");
    expect(remote.send.text).not.toHaveBeenCalled();
  });

  it("valida texto vazio (422) e não atravessa organização (404)", async () => {
    await conectar();
    expect((await enviar({ text: "   " })).statusCode).toBe(422);
    expect((await enviar({ text: "oi" }, cookieB)).statusCode).toBe(404);
  });
});

describe("ligação com o lead", () => {
  const post = (rota: string, payload?: Record<string, unknown>, c = cookie) =>
    app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/${rota}`,
      headers: { cookie: c },
      payload: payload ?? {},
    });

  it("cria lead a partir da conversa, com origem WHATSAPP e telefone formatado", async () => {
    const res = await post("create-client", { name: "Fulano do WhatsApp" });
    expect(res.statusCode).toBe(201);

    const lead = res.json();
    expect(lead.source).toBe("WHATSAPP");
    // o CRM guarda com máscara; os dígitos crus destoariam dos leads cadastrados à mão.
    // 554399990000 tem 10 dígitos nacionais, então a máscara é a de 8 — o formato segue o número.
    expect(lead.phone).toBe("(43) 9999-0000");
    expect(lead.phoneKey).toBe("4399990000");

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversa.clientId).toBe(lead.id);
  });

  it("registra auditoria da criação, como qualquer lead", async () => {
    const res = await post("create-client", { name: "Auditado" });
    const evento = await prisma.auditEvent.findFirst({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: res.json().id },
    });
    expect(evento?.action).toBe("CREATED");
  });

  it("recusa criar quando a conversa já tem lead", async () => {
    await post("create-client", { name: "Primeiro" });
    const res = await post("create-client", { name: "Segundo" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONVERSATION_ALREADY_LINKED");
  });

  it("lista candidatos quando o telefone é ambíguo", async () => {
    await prisma.client.createMany({
      data: [
        { organizationId: orgId, name: "Fixo", phone: "(43) 9999-0000", phoneKey: "4399990000" },
        { organizationId: orgId, name: "Celular", phone: "(43) 99999-0000", phoneKey: "4399990000" },
      ],
    });

    const res = await get(`/v1/whatsapp/conversations/${conversationId}/candidates`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("vincula a um lead existente e permite desvincular", async () => {
    const lead = await prisma.client.create({
      data: { organizationId: orgId, name: "Escolhido", phone: "(43) 98888-7777" },
    });

    await post("link-client", { clientId: lead.id });
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).clientId,
    ).toBe(lead.id);

    await post("unlink-client");
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).clientId,
    ).toBeNull();
  });

  it("não vincula a lead de outra organização", async () => {
    const outraOrg = await prisma.organization.create({
      data: { name: `outra-${stamp}`, slug: `outra-link-${stamp}` },
    });
    const alheio = await prisma.client.create({
      data: { organizationId: outraOrg.id, name: "Alheio", phone: "(43) 97777-6666" },
    });

    const res = await post("link-client", { clientId: alheio.id });
    expect(res.statusCode).toBe(404);
  });

  it("filtra conversas pelo lead — é como a ficha do cliente acha a conversa dele", async () => {
    const criado = (await post("create-client", { name: "Da Ficha" })).json();
    const res = await get(`/v1/whatsapp/conversations?clientId=${criado.id}`);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].id).toBe(conversationId);
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

  it("exclui a conversa e leva as mensagens com ela", async () => {
    const mensagem = await criarMensagem();
    // com mediaKey para exercitar a purga no bucket: chave inexistente serve, porque o
    // DeleteObjects é idempotente e o que se prova é que a purga não derruba o delete
    const comMidia = await criarMensagem({
      mediaStatus: "ready",
      mediaKey: `whatsapp/${orgId}/inexistente-${stamp}.jpg`,
      mediaMime: "image/jpeg",
    });
    // o lead vinculado precisa sobreviver: a relação é dele para a conversa, não o contrário
    const lead = await prisma.client.create({
      data: { organizationId: orgId, name: "Fica", phone: "(43) 98888-0000" },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { clientId: lead.id } });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/whatsapp/conversations/${conversationId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.conversation.findUnique({ where: { id: conversationId } })).toBeNull();
    expect(await prisma.whatsappMessage.findUnique({ where: { id: mensagem.id } })).toBeNull();
    expect(await prisma.whatsappMessage.findUnique({ where: { id: comMidia.id } })).toBeNull();
    expect(await prisma.client.findUnique({ where: { id: lead.id } })).not.toBeNull();
  });

  it("excluir não atravessa organização", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/whatsapp/conversations/${conversationId}`,
      headers: { cookie: cookieB },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.conversation.findUnique({ where: { id: conversationId } })).not.toBeNull();
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
