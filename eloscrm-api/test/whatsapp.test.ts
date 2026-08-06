import { Readable } from "node:stream";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { R2_PRIVATE_BUCKET, headFile, uploadStream } from "../src/lib/storage.js";
import { makeApp } from "./helpers/app.js";
import { signIn, signUp, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/crypto.js";
import { maskPhone } from "../src/lib/audit-snapshot.js";

// A uazapi é serviço de terceiro: mockar o client HTTP é a única forma de exercitar o fluxo sem
// criar instância de verdade a cada run. O banco segue real, como no resto da suíte — a regra
// "sem mocks" do CLAUDE.md é sobre o Postgres, não sobre integração externa.
const remote = {
  admin: { createInstance: vi.fn() },
  instance: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    status: vi.fn(),
    reset: vi.fn(),
    updateName: vi.fn(),
    delete: vi.fn(),
    waMessagesLimits: vi.fn(),
  },
  webhook: { upsert: vi.fn(), get: vi.fn(), errors: vi.fn() },
  send: { text: vi.fn() },
};

vi.mock("../src/lib/uazapi/index.js", () => ({
  createUazapiClient: () => remote,
}));

const ok = <T>(data: T) => ({ success: true as const, data });

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let otherCookie = "";
const email = `wa-owner-${stamp}@eloscrm.test`;
const memberEmail = `wa-member-${stamp}@eloscrm.test`;
const otherEmail = `wa-other-${stamp}@eloscrm.test`;

const TOKEN = `tok-${stamp}`;

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, email, `wa-${stamp}`));
  ({ cookie: otherCookie } = await signUpWithOrg(app, otherEmail, `wa-other-${stamp}`));
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  remote.admin.createInstance.mockResolvedValue(
    ok({ token: TOKEN, instance: { id: `remote-${stamp}`, status: "disconnected" } }),
  );
  remote.webhook.upsert.mockResolvedValue(ok([]));
});

const createInstance = () =>
  app.inject({ method: "POST", url: "/v1/whatsapp/instance", headers: { cookie }, payload: {} });

const dropInstance = () => prisma.uazapiInstance.deleteMany({ where: { organizationId: orgId } });

describe("guards de /v1/whatsapp", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/whatsapp/instance" });
    expect(res.statusCode).toBe(401);
  });

  it("devolve null quando a imobiliária não conectou nenhum WhatsApp", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/whatsapp/instance", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it("corretor (member) não pode criar instância (403)", async () => {
    const memberCookie = await signUp(app, memberEmail);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    await prisma.member.create({
      data: { id: `m-${stamp}`, organizationId: orgId, userId: user.id, role: "member", createdAt: new Date() },
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { cookie: memberCookie },
      payload: { organizationId: orgId },
    });
    const active = await signIn(app, memberEmail);

    const res = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance",
      headers: { cookie: active },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("POST /v1/whatsapp/instance", () => {
  beforeEach(dropInstance);

  it("cria a instância, registra o webhook e não devolve nada que autentique", async () => {
    const res = await createInstance();
    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(body.webhookConfigured).toBe(true);
    expect(body.tokenLast4).toBe(TOKEN.slice(-4));
    expect(body).not.toHaveProperty("tokenEnc");
    expect(body).not.toHaveProperty("tokenHash");
    expect(body).not.toHaveProperty("webhookSecret");
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const [call] = remote.webhook.upsert.mock.calls;
    expect(call[0].events).toEqual(["connection", "messages", "messages_update"]);
    expect(call[0].excludeMessages).toEqual(["wasSentByApi"]);
    expect(call[0].url).toContain(`/webhooks/uazapi/${body.id}/`);
  });

  it("recusa a segunda instância na mesma imobiliária (409)", async () => {
    await createInstance();
    const res = await createInstance();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INSTANCE_ALREADY_EXISTS");
  });

  it("mantém o registro local quando o webhook falha, sinalizando webhookConfigured: false", async () => {
    remote.webhook.upsert.mockResolvedValue({
      success: false,
      error: { status: 500, error: "boom" },
    });
    const res = await createInstance();
    expect(res.statusCode).toBe(201);
    expect(res.json().webhookConfigured).toBe(false);
    // a instância existe no provedor: apagá-la aqui deixaria órfã lá
    expect(await prisma.uazapiInstance.findUnique({ where: { organizationId: orgId } })).not.toBeNull();
  });

  it("não vaza o token em claro no payload dos logs", async () => {
    await createInstance();
    const logs = await prisma.uazapiInstanceLog.findMany();
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it("outra imobiliária não enxerga a instância", async () => {
    await createInstance();
    const res = await app.inject({
      method: "GET",
      url: "/v1/whatsapp/instance",
      headers: { cookie: otherCookie },
    });
    expect(res.json()).toBeNull();
  });
});

describe("POST /v1/whatsapp/instance/connect", () => {
  beforeEach(async () => {
    await dropInstance();
    await createInstance();
  });

  it("persiste o QR code devolvido pela uazapi", async () => {
    remote.instance.connect.mockResolvedValue(
      ok({ instance: { status: "connecting", qrcode: "data:image/png;base64,AAA" } }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/connect",
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "connecting", qrcode: "data:image/png;base64,AAA" });
  });

  it("traduz falha de rede em 504 com código próprio (não mascarado como INTERNAL)", async () => {
    remote.instance.connect.mockResolvedValue({
      success: false,
      error: { status: 0, error: "timeout", error_source: "timeout" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/connect",
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe("UAZAPI_UNAVAILABLE");
  });

  it("marca remoteDeletedAt quando a uazapi diz que a instância sumiu", async () => {
    remote.instance.connect.mockResolvedValue({
      success: false,
      error: { status: 401, error: "invalid token" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/connect",
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INSTANCE_REMOTE_DELETED");

    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(saved.remoteDeletedAt).not.toBeNull();
  });
});

describe("POST /webhooks/uazapi/:instanceId/:secret", () => {
  let instanceId = "";
  let secret = "";

  beforeEach(async () => {
    await dropInstance();
    await createInstance();
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { organizationId: orgId } });
    instanceId = saved.id;
    secret = saved.webhookSecret;
  });

  const post = (id: string, s: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/webhooks/uazapi/${id}/${s}`, payload });

  it("recusa segredo errado (401)", async () => {
    const res = await post(instanceId, "segredo-errado", { EventType: "connection", token: TOKEN });
    expect(res.statusCode).toBe(401);
  });

  it("recusa instância inexistente com 401, não 404 (não enumerar ids)", async () => {
    const res = await post("nao-existe", secret, { EventType: "connection", token: TOKEN });
    expect(res.statusCode).toBe(401);
  });

  it("recusa token que não bate com a instância (401)", async () => {
    const res = await post(instanceId, secret, { EventType: "connection", token: "token-de-outra" });
    expect(res.statusCode).toBe(401);
  });

  // O envelope da uazapi não está na spec e as três fontes disponíveis discordam. Exigir `token`
  // ou o nome `EventType` faria todo evento cair em silêncio se o palpite estiver errado.
  it("aceita o evento sem o campo token (o segredo da URL é a autenticação)", async () => {
    const res = await post(instanceId, secret, {
      EventType: "connection",
      instance: { status: "connected" },
    });
    expect(res.statusCode).toBe(200);
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.status).toBe("connected");
  });

  // Envelope real observado no tráfego da v2.1.1 (ngrok + uazapiGO-Webhook/1.0). Note `owner` no
  // topo, fora de `instance` — antes de constatar isso, ownerJid nunca era preenchido por webhook.
  it("aplica o envelope real da uazapi, com owner no topo", async () => {
    const res = await post(instanceId, secret, {
      BaseUrl: "https://free.uazapi.com",
      EventType: "connection",
      token: TOKEN,
      instanceName: "imob-qa",
      owner: "5543999140409@s.whatsapp.net",
      instance: { name: "imob-qa", status: "connected", qrcode: "" },
    });
    expect(res.statusCode).toBe(200);

    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.status).toBe("connected");
    expect(saved.ownerJid).toBe("5543999140409@s.whatsapp.net");
  });

  it("owner dentro de instance tem precedência sobre o do topo", async () => {
    await post(instanceId, secret, {
      EventType: "connection",
      token: TOKEN,
      owner: "5500000000000@s.whatsapp.net",
      instance: { status: "connected", owner: "5543999140409@s.whatsapp.net" },
    });
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.ownerJid).toBe("5543999140409@s.whatsapp.net");
  });

  it("aceita o envelope na forma event/data do webhook_event.yaml", async () => {
    const res = await post(instanceId, secret, {
      event: "connection",
      token: TOKEN,
      instance: instanceId, // nessa forma `instance` é o id, e o payload vem em `data`
      data: { status: "connected" },
    });
    expect(res.statusCode).toBe(200);
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.status).toBe("connected");
  });

  it("aceita o envelope na forma type/data do SSE", async () => {
    const res = await post(instanceId, secret, {
      type: "connection",
      data: { status: "disconnected" },
    });
    expect(res.statusCode).toBe(200);
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.status).toBe("disconnected");
  });

  // Regressão real: `event` estava tipado como string, e todo messages_update caía com 422 —
  // por horas, sem sintoma nenhum do nosso lado (só em /webhook/errors da uazapi).
  it("aceita messages_update, onde `event` é objeto e `type` é subtipo", async () => {
    const res = await post(instanceId, secret, {
      EventType: "messages_update",
      type: "ReadReceipt",
      state: "Delivered",
      token: TOKEN,
      owner: "554391834229",
      instanceName: "matra",
      event: {
        Chat: "554398414904@s.whatsapp.net",
        MessageIDs: ["ACDBFDADC9802B7379B245CBBAA0A170"],
        // a uazapi manda booleano como string e este Timestamp em SEGUNDOS
        IsFromMe: "False",
        IsGroup: "False",
        Timestamp: "1785820620",
        Type: "Delivered",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });

  it("não rejeita envelope irreconhecível — responde 200 sem gravar", async () => {
    const before = await prisma.uazapiInstanceLog.count({ where: { instanceId } });
    const res = await post(instanceId, secret, { algo: "inesperado" });
    expect(res.statusCode).toBe(200);
    expect(await prisma.uazapiInstanceLog.count({ where: { instanceId } })).toBe(before);
  });

  it("aplica connection: connected e zera o QR", async () => {
    await prisma.uazapiInstance.update({ where: { id: instanceId }, data: { qrcode: "qr-antigo" } });

    const res = await post(instanceId, secret, {
      EventType: "connection",
      token: TOKEN,
      instance: { status: "connected", profileName: "Imobiliária Teste", owner: "5543999140409@s.whatsapp.net" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.status).toBe("connected");
    expect(saved.qrcode).toBeNull();
    expect(saved.profileName).toBe("Imobiliária Teste");

    const log = await prisma.uazapiInstanceLog.findFirst({
      where: { instanceId, source: "webhook" },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.event).toBe("connected");
  });

  it("aplica connection: hibernated — sem isso o status congelaria no anterior", async () => {
    await post(instanceId, secret, {
      EventType: "connection",
      token: TOKEN,
      instance: { status: "connected" },
    });
    await post(instanceId, secret, {
      EventType: "connection",
      token: TOKEN,
      instance: { status: "hibernated" },
    });

    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.status).toBe("hibernated");
  });

  it("reconhece a remoção da instância no provedor pelo motivo da desconexão", async () => {
    const res = await post(instanceId, secret, {
      EventType: "connection",
      token: TOKEN,
      instance: { status: "disconnected", lastDisconnectReason: "Instance deletion requested" },
    });
    expect(res.statusCode).toBe(200);

    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.remoteDeletedAt).not.toBeNull();

    const log = await prisma.uazapiInstanceLog.findFirst({
      where: { instanceId, event: "remote_deleted" },
    });
    expect(log).not.toBeNull();
  });

  it("responde 200 e não grava nada para evento fora da lista assinada", async () => {
    const before = await prisma.uazapiInstanceLog.count({ where: { instanceId } });
    const res = await post(instanceId, secret, {
      EventType: "messages",
      token: TOKEN,
      instance: { status: "connected" },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.uazapiInstanceLog.count({ where: { instanceId } })).toBe(before);
  });

  it("o tokenHash guardado corresponde ao token da instância", async () => {
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(saved.tokenHash).toBe(hashToken(TOKEN));
  });
});

describe("POST /v1/whatsapp/instance/test-send", () => {
  beforeEach(async () => {
    await dropInstance();
    await createInstance();
  });

  const send = (payload: Record<string, unknown>, headers = { cookie }) =>
    app.inject({ method: "POST", url: "/v1/whatsapp/instance/test-send", headers, payload });

  const connect = () =>
    prisma.uazapiInstance.updateMany({
      where: { organizationId: orgId },
      data: { status: "connected" },
    });

  it("recusa envio com a instância desconectada (409)", async () => {
    const res = await send({ number: "5543999140409", text: "oi" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INSTANCE_NOT_CONNECTED");
    expect(remote.send.text).not.toHaveBeenCalled();
  });

  it("envia quando conectada e registra o log sem o texto da mensagem", async () => {
    await connect();
    remote.send.text.mockResolvedValue(ok({ id: "msg-1", status: "Sent" }));

    const res = await send({ number: "5543999140409", text: "conteúdo sigiloso do teste" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "msg-1", status: "Sent" });
    expect(remote.send.text).toHaveBeenCalledWith({
      number: "5543999140409",
      text: "conteúdo sigiloso do teste",
    });

    const log = await prisma.uazapiInstanceLog.findFirst({ where: { event: "test_message_sent" } });
    expect(log?.message).toContain("5543999140409");
    // o texto não tem valor de auditoria e é conteúdo de conversa
    expect(JSON.stringify(log?.payload)).not.toContain("sigiloso");
  });

  it("valida o número (422)", async () => {
    await connect();
    const res = await send({ number: "123", text: "oi" });
    expect(res.statusCode).toBe(422);
  });

  it("recusa texto vazio (422)", async () => {
    await connect();
    const res = await send({ number: "5543999140409", text: "   " });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /v1/whatsapp/instance/webhook", () => {
  beforeEach(async () => {
    await dropInstance();
    await createInstance();
  });

  it("não expõe o webhookSecret pelo histórico de logs", async () => {
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { organizationId: orgId } });
    const res = await app.inject({
      method: "GET",
      url: "/v1/whatsapp/instance/logs",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(saved.webhookSecret);
    // payload bruto da uazapi não sai pela API: pode conter URL de webhook ou campo não revisado
    expect(res.json()[0]).not.toHaveProperty("payload");
  });

  it("mascara o segredo da URL registrada na uazapi", async () => {
    const saved = await prisma.uazapiInstance.findUniqueOrThrow({ where: { organizationId: orgId } });
    const url = `http://localhost:3333/webhooks/uazapi/${saved.id}/${saved.webhookSecret}`;
    remote.webhook.get.mockResolvedValue(ok([{ id: "w1", enabled: true, url, events: ["connection"] }]));

    const res = await app.inject({
      method: "GET",
      url: "/v1/whatsapp/instance/webhook",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const [hook] = res.json();
    expect(hook.isOurs).toBe(true);
    expect(hook.url).toContain("••••");
    expect(res.payload).not.toContain(saved.webhookSecret);
  });
});

describe("auditoria da gestão da instância de WhatsApp", () => {
  // entityId muda por teste (instância nova a cada createInstance): filtrar por ele, e não só por
  // organizationId/entityType, evita que os eventos gravados em outro teste deste arquivo poluam a
  // asserção — o AuditEvent não é limpo por dropInstance, só a tabela UazapiInstance é
  const auditEventsFor = (instanceId: string) =>
    prisma.auditEvent.findMany({
      where: { entityType: "WHATSAPP_INSTANCE", entityId: instanceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  beforeEach(dropInstance);

  it("grava um evento por ação de gestão, ao lado do UazapiInstanceLog, com rótulo/contexto/diff corretos", async () => {
    const created = await createInstance();
    const instanceId = created.json().id;

    remote.instance.updateName.mockResolvedValue(ok({}));
    await app.inject({
      method: "PATCH",
      url: "/v1/whatsapp/instance",
      headers: { cookie },
      payload: { name: "Nome Novo" },
    });

    remote.instance.connect.mockResolvedValue(
      ok({ instance: { status: "connecting", qrcode: "data:image/png;base64,AAA" } }),
    );
    await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/connect",
      headers: { cookie },
      payload: {},
    });

    remote.instance.disconnect.mockResolvedValue(ok({}));
    await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/disconnect",
      headers: { cookie },
      payload: {},
    });

    remote.instance.reset.mockResolvedValue(ok({}));
    await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/reset",
      headers: { cookie },
      payload: {},
    });

    remote.instance.status.mockResolvedValue(
      ok({ instance: { status: "connected", owner: "5543999140409@s.whatsapp.net" } }),
    );
    await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/sync",
      headers: { cookie },
      payload: {},
    });

    remote.webhook.upsert.mockResolvedValue(ok([]));
    await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/webhook/reconcile",
      headers: { cookie },
      payload: {},
    });

    remote.send.text.mockResolvedValue(ok({ id: "msg-1", status: "Sent" }));
    await app.inject({
      method: "POST",
      url: "/v1/whatsapp/instance/test-send",
      headers: { cookie },
      payload: { number: "5543999140409", text: "conteúdo sigiloso do teste" },
    });

    const events = await auditEventsFor(instanceId);
    expect(events.map((e) => e.action)).toEqual([
      "CREATED",
      "UPDATED",
      "CONNECTED",
      "DISCONNECTED",
      "RESET",
      "SYNCED",
      "WEBHOOK_RECONCILED",
      "TEST_MESSAGE_SENT",
    ]);
    // fonte já era USER em todo o resto da suíte, mas aqui é o que garante que actorOf(request)
    // chegou até o recordAudit — não só o actor sintético
    expect(events.every((e) => e.source === "USER" && e.actorName)).toBe(true);

    const [creation, rename, connect, disconnect, reset, sync, reconcile, testSent] = events;

    expect(creation.entityLabel).toMatch(/^wa-/);
    // instância recém-criada ainda não tem ownerJid: o context é omitido, não `{ ownerJid: null }`
    expect(creation.context).toBeNull();

    expect(rename.entityLabel).toBe("Nome Novo");
    expect(rename.changes).toMatchObject({ name: { from: creation.entityLabel, to: "Nome Novo" } });

    for (const event of [connect, disconnect, reset, sync, reconcile, testSent]) {
      expect(event.entityLabel).toBe("Nome Novo");
    }

    // sync populou o ownerJid a partir do `owner` devolvido pela uazapi — o evento seguinte
    // (reconcileWebhook) já enxerga isso no context
    expect((reconcile.context as Record<string, unknown> | null)?.ownerJid).toBe(
      maskPhone("5543999140409@s.whatsapp.net"),
    );

    // testSend: destino mascarado e id da mensagem, nunca o texto
    expect(testSent.context).toMatchObject({
      to: maskPhone("5543999140409"),
      messageId: "msg-1",
    });
    expect(JSON.stringify(testSent)).not.toContain("sigiloso");
    expect(JSON.stringify(testSent)).not.toContain("999140409");
  });

  it("a prévia diz quantas conversas e mídias a remoção vai levar", async () => {
    const created = await createInstance();
    const instanceId = created.json().id;
    const conversation = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `prev-${stamp}@s.whatsapp.net` },
    });
    await prisma.whatsappMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        providerId: `owner:PREV-${stamp}`,
        direction: "inbound",
        type: "image",
        mediaKey: `org/${orgId}/whatsapp/${conversation.id}/prev-${stamp}.jpg`,
        mediaStatus: "ready",
        mediaSize: 2048,
        sentAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/whatsapp/instance/deletion-preview",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // é o número que a tela mostra antes de confirmar: remover a conexão apaga o atendimento inteiro
    expect(res.json()).toMatchObject({
      conversations: 1,
      messages: 1,
      storage: { objects: 1, bytes: 2048 },
    });
  });

  it("remover a instância apaga as mídias no R2 junto com as conversas", async () => {
    const created = await createInstance();
    const instanceId = created.json().id;
    const conversation = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `midia-${stamp}@s.whatsapp.net` },
    });
    // objeto de verdade: chave inventada faria o DeleteObjects devolver sucesso sem provar nada
    const mediaKey = `org/${orgId}/whatsapp/${conversation.id}/foto-${stamp}.jpg`;
    await uploadStream(R2_PRIVATE_BUCKET, mediaKey, Readable.from([Buffer.from("foto")]), "image/jpeg");
    await prisma.whatsappMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        providerId: `owner:MIDIA-${stamp}`,
        direction: "inbound",
        type: "image",
        mediaKey,
        mediaStatus: "ready",
        mediaSize: 4,
        sentAt: new Date(),
      },
    });
    expect(await headFile(R2_PRIVATE_BUCKET, mediaKey).catch(() => null)).toBeTruthy();

    remote.instance.delete.mockResolvedValue(ok({}));
    expect(
      (await app.inject({ method: "DELETE", url: "/v1/whatsapp/instance", headers: { cookie } })).statusCode,
    ).toBe(204);

    // as conversas cascateiam da instância; o bucket não cascateia, e é isto que o service faz
    expect(await prisma.conversation.count({ where: { id: conversation.id } })).toBe(0);
    expect(await headFile(R2_PRIVATE_BUCKET, mediaKey).catch(() => null)).toBeNull();
  });

  it("apaga a instância mas os eventos de auditoria continuam legíveis (D6)", async () => {
    const created = await createInstance();
    const instanceId = created.json().id;

    remote.instance.delete.mockResolvedValue(ok({}));
    const res = await app.inject({ method: "DELETE", url: "/v1/whatsapp/instance", headers: { cookie } });
    expect(res.statusCode).toBe(204);

    expect(await prisma.uazapiInstance.findUnique({ where: { id: instanceId } })).toBeNull();
    // o UazapiInstanceLog da criação cascateia com a instância
    expect(await prisma.uazapiInstanceLog.count({ where: { instanceId } })).toBe(0);

    const events = await auditEventsFor(instanceId);
    expect(events.map((e) => e.action)).toEqual(["CREATED", "DELETED"]);
    const deleted = events.find((e) => e.action === "DELETED")!;
    expect(deleted.entityLabel).toMatch(/^wa-/);
    expect(deleted.actorName).toBeTruthy();
  });
});
