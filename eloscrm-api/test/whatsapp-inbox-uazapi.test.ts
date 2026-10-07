import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
const remote = { send: { text: vi.fn() } };
vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => remote }));
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import { sameSenderNumber } from "../src/modules/whatsapp-inbox/uazapi-policy.repo.js";
import { get, messages } from "../src/modules/whatsapp-inbox/inbox.service.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let foreignCookie: string;
let instanceId: string;
let connectionId: string;
let conversationId: string;
let contactId: string;
const headers = () => ({ cookie, origin: env.WEB_ORIGIN });
const payload = () => ({ text: "Mensagem fictícia", idempotencyKey: randomUUID(), confirmManualException: true });
const url = () => `/v1/whatsapp/inbox/conversations/${conversationId}/uazapi/messages`;
beforeAll(async () => {
  app = await makeApp(); const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `manual-${suffix}@eloscrm.test`, `manual-${suffix}`));
  ({ cookie: foreignCookie } = await signUpWithOrg(app, `manual-other-${suffix}@eloscrm.test`, `manual-other-${suffix}`));
  const token = randomBytes(24).toString("base64url");
  instanceId = (await prisma.uazapiInstance.create({ data: { organizationId: orgId, remoteId: suffix, name: "Instância fictícia", status: "connected", ownerJid: "5543999140409@s.whatsapp.net", tokenEnc: encryptToken(token), tokenHash: hashToken(token), webhookSecret: randomBytes(24).toString("base64url") } })).id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  remote.send.text.mockReset().mockResolvedValue({ success: true, data: { messageid: "provider-fixture" } });
  await prisma.uazapiInstance.update({ where: { id: instanceId }, data: { status: "connected", ownerJid: "5543999140409@s.whatsapp.net" } });
  const fixture = await createOfficialConnectionFixture(orgId, { displayPhoneNumber: "+55 43 99914-0409" }); connectionId = fixture.connection.id;
  const connection = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } });
  conversationId = await ingestMessage(connection, { id: `manual-inbound-${randomUUID()}`, from: "5543998414904", type: "text", text: { body: "Consulta fictícia" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "cloud_api", new Date());
  contactId = (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).messagingContactId!;
});

describe("uazapi como escolha manual no número oficial", () => {
  it("compara DDI e nono dígito sem aceitar colisão de país ou telefone fixo", () => {
    expect(sameSenderNumber("+55 (43) 99914-0409", "5543999140409@s.whatsapp.net")).toBe(true);
    expect(sameSenderNumber("+55 43 9914-0409", "5543999140409@s.whatsapp.net")).toBe(true);
    expect(sameSenderNumber("+55 43 3324-1234", "5543933241234@s.whatsapp.net")).toBe(false);
    expect(sameSenderNumber("+1 4343999140409", "5543999140409@s.whatsapp.net")).toBe(false);
    expect(sameSenderNumber(null, "5543999140409@s.whatsapp.net")).toBe(false);
  });
  it("envia pelo mesmo número e grava origem e auditoria na própria conversa oficial", async () => {
    expect((await get(orgId, `contact:${contactId}`)).channels[0]!.uazapiManual?.allowed).toBe(true);
    const response = await app.inject({ method: "POST", url: url(), headers: headers(), payload: payload() });
    expect(response.statusCode).toBe(201); expect(response.json().status).toBe("sent");
    expect(remote.send.text).toHaveBeenCalledWith(expect.objectContaining({ number: "5543998414904", text: "Mensagem fictícia" }));
    const message = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: response.json().id } });
    expect(message).toMatchObject({ conversationId, connectionId, origin: "uazapi", direction: "outbound" });
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, entityId: message.id, action: "MESSAGE_SENT" } })).not.toBeNull();
    expect((await get(orgId, `contact:${contactId}`)).channels).toHaveLength(1);
  });
  it("bloqueia outro número, conexão sem Coexistence e BSUID sem telefone", async () => {
    await prisma.uazapiInstance.update({ where: { id: instanceId }, data: { ownerJid: "5543991112222@s.whatsapp.net" } });
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: payload() })).json().error.code).toBe("UAZAPI_NUMBER_MISMATCH");
    await prisma.uazapiInstance.update({ where: { id: instanceId }, data: { ownerJid: "5543999140409@s.whatsapp.net" } });
    await prisma.channelConnection.update({ where: { id: connectionId }, data: { isOnBusinessApp: false } });
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: payload() })).json().error.code).toBe("UAZAPI_OFFICIAL_UNAVAILABLE");
    await prisma.channelConnection.update({ where: { id: connectionId }, data: { isOnBusinessApp: true } });
    await prisma.contactIdentity.updateMany({ where: { organizationId: orgId, contactId }, data: { kind: "bsuid", value: "BR.fixture" } });
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: payload() })).json().error.code).toBe("UAZAPI_RECIPIENT_UNAVAILABLE");
    expect(remote.send.text).not.toHaveBeenCalled();
  });
  it("exige confirmação, rejeita destino do navegador e protege tenant e origem", async () => {
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: { ...payload(), confirmManualException: false } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: { ...payload(), number: "5543991112222" } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: url(), headers: { cookie: foreignCookie, origin: env.WEB_ORIGIN }, payload: payload() })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: url(), headers: { ...headers(), origin: "https://example.invalid" }, payload: payload() })).statusCode).toBe(403);
    expect(remote.send.text).not.toHaveBeenCalled();
  });
  it("duas confirmações concorrentes fazem uma chamada; chave alterada é recusada", async () => {
    const input = payload();
    const results = await Promise.all([app.inject({ method: "POST", url: url(), headers: headers(), payload: input }), app.inject({ method: "POST", url: url(), headers: headers(), payload: input })]);
    expect(results.every(result => result.statusCode === 201)).toBe(true);
    expect(results[0]!.json().id).toBe(results[1]!.json().id);
    expect(remote.send.text).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: { ...input, text: "Outro conteúdo" } })).statusCode).toBe(409);
  });
  it("timeout permanece incerto no histórico e consultas não reenviam", async () => {
    remote.send.text.mockRejectedValueOnce(new Error("Conteúdo privado ignorado"));
    const input = payload();
    const first = await app.inject({ method: "POST", url: url(), headers: headers(), payload: input });
    const second = await app.inject({ method: "POST", url: url(), headers: headers(), payload: input });
    expect(first.json().status).toBe("uncertain"); expect(second.json().status).toBe("uncertain");
    expect(remote.send.text).toHaveBeenCalledTimes(1);
    const history = await messages(orgId, `contact:${contactId}`, { limit: 40 });
    expect(history.items.find(message => message.id === first.json().id)?.uazapiManual?.status).toBe("uncertain");
    expect(JSON.stringify(history)).not.toContain("Conteúdo privado");
  });
  it("a rota antiga também recusa envio por outro número", async () => {
    await prisma.uazapiInstance.update({ where: { id: instanceId }, data: { ownerJid: "5543991112222@s.whatsapp.net" } });
    const conversation = await prisma.conversation.create({ data: { organizationId: orgId, instanceId, phone: "5543998414904", chatid: "5543998414904@s.whatsapp.net" } });
    const response = await app.inject({ method: "POST", url: `/v1/whatsapp/conversations/${conversation.id}/messages`, headers: headers(), payload: { text: "Teste fictício" } });
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("UAZAPI_NUMBER_MISMATCH");
    expect(remote.send.text).not.toHaveBeenCalled();
  });
});
