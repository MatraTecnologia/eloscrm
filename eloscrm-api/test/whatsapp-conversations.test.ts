import { Readable } from "node:stream";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";
import { R2_PRIVATE_BUCKET, headFile, uploadStream } from "../src/lib/storage.js";

const remote = { send: { text: vi.fn(), media: vi.fn() } };
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

const existeNoBucket = async (key: string) =>
  !!(await headFile(R2_PRIVATE_BUCKET, key).catch(() => null));

const eventsOf = (entityType: AuditEntity, entityId: string) =>
  prisma.auditEvent.findMany({
    where: { organizationId: orgId, entityType, entityId },
    orderBy: { createdAt: "asc" },
  });

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

  it("a prévia traz o tipo da última mensagem, não só o texto", async () => {
    await criarMensagem({ text: "oi", sentAt: new Date(Date.now() - 60_000) });
    await criarMensagem({
      type: "ptt",
      text: null,
      mediaDuration: 16,
      sentAt: new Date(),
    });

    const { items } = (await get("/v1/whatsapp/conversations")).json();

    expect(items[0].lastMessage).toMatchObject({ type: "ptt", mediaDuration: 16, text: null });
  });

  it("documento leva o nome do arquivo para a prévia", async () => {
    await criarMensagem({ type: "document", text: null, mediaFilename: "contrato.pdf" });

    const { items } = (await get("/v1/whatsapp/conversations")).json();

    expect(items[0].lastMessage.mediaFilename).toBe("contrato.pdf");
  });

  it("reação não vira prévia — ela não é uma linha da conversa", async () => {
    await criarMensagem({ text: "combinado", sentAt: new Date(Date.now() - 60_000) });
    await criarMensagem({ type: "reaction", text: "👍", sentAt: new Date() });

    const { items } = (await get("/v1/whatsapp/conversations")).json();

    expect(items[0].lastMessage.text).toBe("combinado");
  });

  it("prévia de mensagem apagada não carrega o conteúdo no JSON", async () => {
    await criarMensagem({
      type: "document",
      text: "segredo",
      mediaFilename: "contrato.pdf",
      deletedAt: new Date(),
    });

    const { items } = (await get("/v1/whatsapp/conversations")).json();

    expect(items[0].lastMessage.deletedAt).not.toBeNull();
    expect(items[0].lastMessage.text).toBeNull();
    expect(items[0].lastMessage.mediaFilename).toBeNull();
    expect(JSON.stringify(items)).not.toContain("segredo");
  });

  it("conversa sem mensagem nenhuma devolve prévia nula, não estoura", async () => {
    const { items } = (await get("/v1/whatsapp/conversations")).json();

    expect(items[0].lastMessage).toBeNull();
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

  it("erro que estoura no envio de texto também marca a bolha como falha", async () => {
    await conectar();
    remote.send.text.mockRejectedValue(new Error("rede caiu"));

    const res = await enviar({ text: "Bom dia" });

    expect(res.statusCode).toBe(500);
    const salva = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId } });
    expect(salva.status).toBe("failed");
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

  it("registra MESSAGE_SENT depois do envio confirmado, sem o texto no snapshot", async () => {
    await conectar();
    const res = await enviar({ text: "Bom dia! Já retorno com os valores." });
    const message = res.json();

    const eventos = await eventsOf(AuditEntity.WHATSAPP_MESSAGE, message.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].action).toBe(AuditAction.MESSAGE_SENT);
    expect(eventos[0].entityLabel).toBe("Fulano");
    expect(eventos[0].context).toEqual({ conversationId });
    expect(eventos[0].snapshot).toEqual({ direction: "outbound", type: "text", sentAt: expect.any(String) });
    // conteúdo de conversa não é dado de auditoria (D9)
    expect(JSON.stringify(eventos[0].snapshot)).not.toContain("Bom dia");
  });

  it("envio que falhou não gera evento de auditoria — houve tentativa, não envio", async () => {
    await conectar();
    remote.send.text.mockResolvedValue({ success: false, error: { status: 500, error: "boom" } });

    const antes = await prisma.auditEvent.count({ where: { organizationId: orgId } });
    await enviar({ text: "não vai sair" });
    const depois = await prisma.auditEvent.count({ where: { organizationId: orgId } });
    expect(depois).toBe(antes);
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

  it("registra CONVERSATION LINKED ao criar lead a partir da conversa", async () => {
    const res = await post("create-client", { name: "Auditado" });
    const lead = res.json();

    const eventos = await eventsOf(AuditEntity.CONVERSATION, conversationId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].action).toBe(AuditAction.LINKED);
    expect(eventos[0].context).toEqual({ clientName: lead.name });
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

  it("vincula a um lead existente e permite desvincular, registrando LINKED e UNLINKED", async () => {
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

    const eventos = await eventsOf(AuditEntity.CONVERSATION, conversationId);
    expect(eventos.map((e) => e.action)).toEqual([AuditAction.LINKED, AuditAction.UNLINKED]);
    expect(eventos[0].context).toEqual({ clientName: "Escolhido" });
    // UNLINKED guarda o nome de quem se soltou — lido antes de limpar o clientId
    expect(eventos[1].context).toEqual({ clientName: "Escolhido" });
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

  it("arquiva e desarquiva, registrando ARCHIVED e UNARCHIVED", async () => {
    const url = `/v1/whatsapp/conversations/${conversationId}`;
    await app.inject({ method: "POST", url: `${url}/archive`, headers: { cookie } });
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).archivedAt,
    ).not.toBeNull();

    await app.inject({ method: "POST", url: `${url}/unarchive`, headers: { cookie } });
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).archivedAt,
    ).toBeNull();

    const eventos = await eventsOf(AuditEntity.CONVERSATION, conversationId);
    expect(eventos.map((e) => e.action)).toEqual([AuditAction.ARCHIVED, AuditAction.UNARCHIVED]);
    expect(eventos[0].entityLabel).toBe("Fulano");
  });

  it("exclui a conversa e leva as mensagens com ela, registrando DELETED com a contagem antes de apagar", async () => {
    const mensagem = await criarMensagem({ sentAt: new Date("2026-08-01T10:00:00Z") });
    // objeto de verdade no bucket, não chave inventada: com uma chave inexistente o DeleteObjects
    // devolve sucesso de qualquer forma, e o teste passaria mesmo se a purga não existisse
    const mediaKey = `org/${orgId}/whatsapp/${conversationId}/purga-${stamp}.jpg`;
    await uploadStream(R2_PRIVATE_BUCKET, mediaKey, Readable.from([Buffer.from("midia")]), "image/jpeg");
    expect(await existeNoBucket(mediaKey)).toBe(true);

    const comMidia = await criarMensagem({
      mediaStatus: "ready",
      mediaKey,
      mediaMime: "image/jpeg",
      sentAt: new Date("2026-08-01T11:00:00Z"),
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
    // o arquivo sai do R2 junto: a linha morrer sem o objeto deixaria mídia paga e órfã no bucket
    expect(await existeNoBucket(mediaKey)).toBe(false);
    expect(await prisma.client.findUnique({ where: { id: lead.id } })).not.toBeNull();

    // o evento sobrevive à conversa: rótulo e contagem foram lidos antes do delete
    const evento = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: "CONVERSATION", entityId: conversationId, action: "DELETED" },
    });
    expect(evento.entityLabel).toBe("Fica");
    expect(evento.snapshot).toEqual({
      phoneMasked: expect.any(String),
      isGroup: false,
      messageCount: 2,
      firstMessageAt: "2026-08-01T10:00:00.000Z",
      lastMessageAt: "2026-08-01T11:00:00.000Z",
    });
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

  it("marcar como lida e ingerir mensagem recebida não geram evento de auditoria (D7)", async () => {
    const antes = await prisma.auditEvent.count({ where: { organizationId: orgId } });

    await app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/read`,
      headers: { cookie },
    });

    const conversa = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const instance = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    // envelope real observado no tráfego (§2.1 do spec de conversas) — mesmo formato de
    // test/whatsapp-ingest.test.ts, reaproveitado aqui só para provar ausência de evento
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/uazapi/${instanceId}/${instance.webhookSecret}`,
      payload: {
        BaseUrl: "https://matratecnologia.uazapi.com",
        EventType: "messages",
        instanceName: instance.name,
        owner: "554391834229",
        chat: {
          wa_chatid: conversa.chatid,
          phone: conversa.phone,
          wa_name: conversa.waName,
          wa_isGroup: false,
        },
        message: {
          id: `554391834229:D7-${stamp}`,
          messageid: `D7-${stamp}`,
          chatid: conversa.chatid,
          sender: "226070083190831@lid",
          sender_pn: `${conversa.phone}@s.whatsapp.net`,
          senderName: "Fulano",
          fromMe: false,
          isGroup: false,
          messageTimestamp: Date.now(),
          wasSentByApi: false,
          type: "text",
          messageType: "Conversation",
          text: "mais uma mensagem",
          content: "mais uma mensagem",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(
      await prisma.whatsappMessage.findFirst({ where: { conversationId, text: "mais uma mensagem" } }),
    ).not.toBeNull();

    const depois = await prisma.auditEvent.count({ where: { organizationId: orgId } });
    expect(depois).toBe(antes);
  });
});

/**
 * O envio de mídia não roda de ponta a ponta em desenvolvimento — a uazapi não alcança o storage
 * local, igual ao webhook. O que dá para provar aqui é o contrato: o que sai para o provedor, o que
 * fica no banco e, principalmente, que a chave que o cliente manda não abre porta para arquivo de
 * outra conversa.
 */
describe("POST /v1/whatsapp/conversations/:id/messages/media", () => {
  const conectar = () =>
    prisma.uazapiInstance.update({ where: { id: instanceId }, data: { status: "connected" } });

  const pedirUpload = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/media/upload-url`,
      headers: { cookie },
      payload,
    });

  const enviar = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/v1/whatsapp/conversations/${conversationId}/messages/media`,
      headers: { cookie },
      payload,
    });

  /** Sobe de verdade no bucket de teste: o envio faz HEAD e recusa o que não chegou. */
  const subir = async (key: string, contentType: string, conteudo = "arquivo") => {
    await uploadStream(R2_PRIVATE_BUCKET, key, Readable.from([Buffer.from(conteudo)]), contentType);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    remote.send.media.mockResolvedValue({
      success: true,
      data: { id: "554391834229:MIDIA1", messageid: "MIDIA1", status: "Pending" },
    });
    await conectar();
  });

  it("a chave do upload nasce no escopo desta conversa", async () => {
    const res = await pedirUpload({
      filename: "Planta do Apê.pdf",
      contentType: "application/pdf",
      size: 1024,
    });

    expect(res.statusCode).toBe(201);
    const { key, uploadUrl } = res.json();
    expect(key.startsWith(`org/${orgId}/whatsapp/${conversationId}/`)).toBe(true);
    // acento e espaço não vão crus para a chave
    expect(key).toContain("planta-do-ape.pdf");
    expect(uploadUrl).toContain("X-Amz-Signature");
  });

  it("recusa arquivo maior do que o WhatsApp aceita, antes de subir", async () => {
    const res = await pedirUpload({
      filename: "video.mp4",
      contentType: "video/mp4",
      size: 20 * 1024 * 1024,
    });

    expect(res.statusCode).toBe(422);
  });

  it("documento vai com docName e mimetype, e a mensagem já nasce pronta", async () => {
    const { key } = (
      await pedirUpload({ filename: "contrato.pdf", contentType: "application/pdf", size: 8 })
    ).json();
    await subir(key, "application/pdf");

    const res = await enviar({ key, filename: "contrato.pdf", contentType: "application/pdf" });

    expect(res.statusCode).toBe(201);
    expect(remote.send.media).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "document",
        docName: "contrato.pdf",
        mimetype: "application/pdf",
        number: "554399990000",
      }),
    );
    // é URL do nosso storage, não base64
    expect(remote.send.media.mock.calls[0][0].file).toContain("X-Amz-Signature");

    const salva = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId } });
    expect(salva.type).toBe("document");
    expect(salva.status).toBe("sent");
    expect(salva.providerMessageId).toBe("MIDIA1");
    // nasce no nosso bucket, então não passa pela fila de download
    expect(salva.mediaStatus).toBe("ready");
    expect(salva.mediaKey).toBe(key);
  });

  it("foto com legenda vira bolha de imagem com texto", async () => {
    const { key } = (
      await pedirUpload({ filename: "fachada.jpg", contentType: "image/jpeg", size: 8 })
    ).json();
    await subir(key, "image/jpeg");

    await enviar({
      key,
      filename: "fachada.jpg",
      contentType: "image/jpeg",
      caption: "A fachada do prédio",
    });

    expect(remote.send.media).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image", text: "A fachada do prédio" }),
    );
    // docName só existe para documento: nos outros o WhatsApp o mostraria como legenda
    expect(remote.send.media.mock.calls[0][0].docName).toBeUndefined();

    const salva = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId } });
    expect(salva.type).toBe("image");
    expect(salva.text).toBe("A fachada do prédio");
  });

  it("chave de outra conversa é recusada, mesmo dentro da imobiliária", async () => {
    const outra = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `outra-${stamp}@s.whatsapp.net` },
    });
    const chaveAlheia = `org/${orgId}/whatsapp/${outra.id}/x-foto.jpg`;
    await subir(chaveAlheia, "image/jpeg");

    const res = await enviar({
      key: chaveAlheia,
      filename: "foto.jpg",
      contentType: "image/jpeg",
    });

    expect(res.statusCode).toBe(404);
    expect(remote.send.media).not.toHaveBeenCalled();
  });

  it("chave de outra imobiliária é recusada", async () => {
    const res = await enviar({
      key: "org/outra-org/whatsapp/qualquer/x-foto.jpg",
      filename: "foto.jpg",
      contentType: "image/jpeg",
    });

    expect(res.statusCode).toBe(404);
    expect(remote.send.media).not.toHaveBeenCalled();
  });

  it("arquivo que nunca chegou ao storage não vira mensagem", async () => {
    const { key } = (
      await pedirUpload({ filename: "sumiu.jpg", contentType: "image/jpeg", size: 8 })
    ).json();

    const res = await enviar({ key, filename: "sumiu.jpg", contentType: "image/jpeg" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("UPLOAD_NOT_FOUND");
    expect(await prisma.whatsappMessage.count({ where: { conversationId } })).toBe(0);
  });

  it("o que subiu tem de ser do tipo declarado", async () => {
    const { key } = (
      await pedirUpload({ filename: "fachada.jpg", contentType: "image/jpeg", size: 8 })
    ).json();
    // a URL assinada não carrega o content-type: o cliente pode subir outra coisa nela
    await subir(key, "application/pdf");

    const res = await enviar({ key, filename: "fachada.jpg", contentType: "image/jpeg" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("UPLOAD_TYPE_MISMATCH");
  });

  it("falha do provedor deixa a bolha como falha, com o arquivo preservado", async () => {
    remote.send.media.mockResolvedValue({
      success: false,
      error: { kind: "http", status: 400, message: "recusado" },
    });
    const { key } = (
      await pedirUpload({ filename: "fachada.jpg", contentType: "image/jpeg", size: 8 })
    ).json();
    await subir(key, "image/jpeg");

    const res = await enviar({ key, filename: "fachada.jpg", contentType: "image/jpeg" });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const salva = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId } });
    expect(salva.status).toBe("failed");
    // o arquivo continua lá: a bolha de erro mostra o que o corretor escolheu
    expect(await existeNoBucket(key)).toBe(true);
  });

  it("erro que estoura, e não retorna falha, também marca a bolha", async () => {
    // token que não descriptografa, DNS que não resolve, rede que caiu: a chamada lança em vez de
    // devolver `success: false`, e sem tratar a mensagem ficaria "pendente" para sempre
    // `mockImplementation` que lança, não `mockRejectedValue`: quem estoura de verdade é o
    // `instanceClient` ao descriptografar o token, **antes** de existir promise — e é justamente
    // esse caso que um `.catch()` encadeado deixaria passar
    remote.send.media.mockImplementation(() => {
      throw new Error("token corrompido");
    });
    const { key } = (
      await pedirUpload({ filename: "fachada.jpg", contentType: "image/jpeg", size: 8 })
    ).json();
    await subir(key, "image/jpeg");

    const res = await enviar({ key, filename: "fachada.jpg", contentType: "image/jpeg" });

    expect(res.statusCode).toBe(500);
    const salva = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId } });
    expect(salva.status).toBe("failed");
  });

  it("WhatsApp desconectado nem chega a assinar upload", async () => {
    await prisma.uazapiInstance.update({
      where: { id: instanceId },
      data: { status: "disconnected" },
    });

    const res = await pedirUpload({
      filename: "fachada.jpg",
      contentType: "image/jpeg",
      size: 8,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INSTANCE_NOT_CONNECTED");
  });
});
