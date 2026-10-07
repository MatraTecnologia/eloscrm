import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import * as inbox from "../src/modules/whatsapp-inbox/inbox.service.js";
import * as repo from "../src/modules/whatsapp-inbox/inbox.repo.js";
import type { ChannelConnection } from "../src/generated/prisma/client.js";

let app: FastifyInstance;
let orgA: string;
let orgB: string;
let cookieA: string;
let cookieB: string;
let userId: string;
let official: ChannelConnection;
let officialConversationId: string;
let contactId: string;
let clientId: string;
let legacyConversationId: string;
let instanceId: string;
let sequence = 0;
const stamp = `${process.pid}-${Date.now()}`;
const headers = () => ({ cookie: cookieA, origin: env.WEB_ORIGIN });
const actor = () => ({ id: userId, name: "Corretor fictício" });
const listInput = { filter: "all" as const, limit: 100 };
beforeAll(async () => {
  app = await makeApp();
  ({ orgId: orgA, cookie: cookieA } = await signUpWithOrg(app, `inbox-a-${stamp}@eloscrm.test`, `inbox-a-${stamp}`));
  ({ orgId: orgB, cookie: cookieB } = await signUpWithOrg(app, `inbox-b-${stamp}@eloscrm.test`, `inbox-b-${stamp}`));
  const session = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie: cookieA } });
  userId = session.json().user.id;
  const token = randomBytes(24).toString("base64url");
  const instance = await prisma.uazapiInstance.create({ data: { organizationId: orgA, remoteId: `inbox-fixture-${stamp}`, name: "Número residual", status: "connected", ownerJid: "15550002222@s.whatsapp.net", tokenEnc: encryptToken(token), tokenHash: hashToken(token), webhookSecret: randomBytes(24).toString("base64url") } });
  instanceId = instance.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  const fixture = await createOfficialConnectionFixture(orgA);
  official = (await prisma.channelConnection.findFirstOrThrow({ where: { organizationId: orgA, id: fixture.connection.id } }));
  officialConversationId = await ingestMessage(official, { id: `inbox-inbound-${sequence++}`, from: "15550001111", type: "text", text: { body: "Consulta fictícia" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "cloud_api", new Date());
  contactId = (await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgA, id: officialConversationId } })).messagingContactId!;
  clientId = (await prisma.client.create({ data: { organizationId: orgA, name: `Lead integrado ${sequence++}`, phone: "15550001111" } })).id;
  legacyConversationId = (await prisma.conversation.create({ data: { organizationId: orgA, instanceId, clientId, chatid: `15550001111-${sequence++}@s.whatsapp.net`, phone: "15550001111", lastMessageAt: new Date(), lastMessageText: "Resposta pelo número residual", unreadCount: 2 } })).id;
});

describe("atendimento WhatsApp unificado", () => {
  it("exige sessão e isola grupos, mensagens, read e vínculo por imobiliária", async () => {
    const id = `contact:${contactId}`;
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/inbox" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/inbox/${id}`, headers: { cookie: cookieB } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/inbox/${id}/messages`, headers: { cookie: cookieB } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/inbox/${id}/read`, headers: { cookie: cookieB, origin: env.WEB_ORIGIN }, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/inbox/${id}/read`, headers: { ...headers(), origin: "https://foreign.eloscrm.test" }, payload: {} })).statusCode).toBe(403);
    await expect(inbox.linkOfficial(orgB, officialConversationId, clientId, actor())).rejects.toMatchObject({ statusCode: 404 });
  });
  it("telefone igual não une contatos; vínculo explícito reúne os dois canais", async () => {
    const before = await inbox.list(orgA, listInput);
    expect(before.items.find(item => item.id === `contact:${contactId}`)?.channels).toHaveLength(1);
    expect(before.items.find(item => item.id === `client:${clientId}`)?.channels).toHaveLength(1);
    const linked = await inbox.linkOfficial(orgA, officialConversationId, clientId, actor());
    const group = await inbox.get(orgA, linked.id);
    expect(group.channels).toHaveLength(2);
    expect(group.channels.map(channel => channel.provider).sort()).toEqual(["cloud_api", "uazapi"]);
    expect(group.unreadCount).toBe(3);
    expect(group.name).toMatch(/Lead integrado/);
    expect(await repo.children(orgA, `contact:${contactId}`)).toEqual([]);
  });
  it("não reúne mesmo telefone em portfolios distintos nem contato ambíguo no lead", async () => {
    await inbox.linkOfficial(orgA, officialConversationId, clientId, actor());
    const fixture = await createOfficialConnectionFixture(orgA);
    const channel = await prisma.channelConnection.findFirstOrThrow({ where: { organizationId: orgA, id: fixture.connection.id } });
    const otherId = await ingestMessage(channel, { id: `inbox-other-${sequence++}`, from: "15550001111", type: "text", text: { body: "Outro portfolio" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "cloud_api", new Date());
    await expect(inbox.linkOfficial(orgA, otherId, clientId, actor())).rejects.toMatchObject({ code: "OFFICIAL_CLIENT_LINKED" });
    expect((await inbox.get(orgA, `client:${clientId}`)).channels).toHaveLength(2);
  });
  it("retorna identidades BSUID sem telefone e não retorna credenciais", async () => {
    await prisma.contactIdentity.updateMany({ where: { organizationId: orgA, contactId }, data: { kind: "bsuid", value: "BR.ABC.fixture" } });
    await prisma.conversation.update({ where: { id: officialConversationId }, data: { phone: null } });
    const response = await app.inject({ method: "GET", url: `/v1/whatsapp/inbox/contact:${contactId}`, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json().channels[0].identities[0].kind).toBe("bsuid");
    expect(response.body).not.toContain("tokenEnc");
    expect(response.body).not.toContain("businessPortfolioId");
    expect(response.body).not.toContain("webhookSecret");
  });
  it("pagina mensagens dos dois canais com timestamps iguais sem perdas nem duplicações", async () => {
    await inbox.linkOfficial(orgA, officialConversationId, clientId, actor());
    await prisma.whatsappMessage.deleteMany({ where: { organizationId: orgA, conversationId: officialConversationId } });
    const at = new Date("2026-10-01T12:00:00Z");
    for (let index = 0; index < 7; index++) await prisma.whatsappMessage.create({ data: { id: `aggregate-${sequence}-${index}`, organizationId: orgA, conversationId: index % 2 ? legacyConversationId : officialConversationId, connectionId: index % 2 ? null : official.id, providerId: `same-${index}`, providerMessageId: `same-${index}`, origin: index % 2 ? "uazapi" : "business_app", direction: "outbound", type: "text", text: `Mensagem ${index}`, sentAt: at } });
    const seen: string[] = [];
    let before: string | undefined;
    do {
      const page = await inbox.messages(orgA, `client:${clientId}`, { limit: 2, before });
      seen.push(...page.items.map(message => message.id));
      before = page.nextBefore;
    } while (before);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });
  it("cursor de mensagem de outro atendimento é recusado", async () => {
    const foreign = await prisma.whatsappMessage.create({ data: { organizationId: orgA, conversationId: legacyConversationId, providerId: `foreign-${sequence++}`, direction: "inbound", type: "text", text: "Outro atendimento", sentAt: new Date() } });
    await expect(inbox.messages(orgA, `contact:${contactId}`, { limit: 40, before: foreign.id })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("pagina grupos com desempate determinístico e valida cursor", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await inbox.list(orgA, { ...listInput, limit: 2, cursor });
      seen.push(...page.items.map(item => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(`contact:${contactId}`);
    await expect(inbox.list(orgA, { ...listInput, cursor: "invalid" })).rejects.toMatchObject({ code: "INBOX_CURSOR_INVALID" });
  });
  it("busca e filtros atuam no agregado, preservando canais arquivados no histórico", async () => {
    await inbox.linkOfficial(orgA, officialConversationId, clientId, actor());
    await prisma.conversation.update({ where: { id: legacyConversationId }, data: { archivedAt: new Date() } });
    const page = await inbox.list(orgA, { ...listInput, q: (await inbox.get(orgA, `client:${clientId}`)).name });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.channels).toHaveLength(2);
    expect((await inbox.list(orgA, { ...listInput, clientId, filter: "archived" })).items).toEqual([]);
    await inbox.read(orgA, `client:${clientId}`);
    expect((await inbox.get(orgA, `client:${clientId}`)).unreadCount).toBe(0);
    expect((await inbox.list(orgA, { ...listInput, clientId, filter: "unread" })).items).toEqual([]);
    await prisma.conversation.update({ where: { id: officialConversationId }, data: { archivedAt: new Date() } });
    expect((await inbox.list(orgA, { ...listInput, clientId })).items).toHaveLength(1);
    expect((await inbox.list(orgA, { ...listInput, filter: "archived" })).items.map(item => item.id)).toContain(`client:${clientId}`);
  });
  it("resolve citação no canal de origem e oculta a prévia apagada", async () => {
    await inbox.linkOfficial(orgA, officialConversationId, clientId, actor());
    const sharedId = `quote-${sequence++}`;
    const original = await prisma.whatsappMessage.create({ data: { organizationId: orgA, conversationId: officialConversationId, connectionId: official.id, providerId: sharedId, providerMessageId: sharedId, direction: "inbound", type: "text", text: "Original oficial", sentAt: new Date() } });
    await prisma.whatsappMessage.create({ data: { organizationId: orgA, conversationId: legacyConversationId, providerId: sharedId, providerMessageId: sharedId, direction: "inbound", type: "text", text: "Original residual", sentAt: new Date() } });
    const reply = await prisma.whatsappMessage.create({ data: { organizationId: orgA, conversationId: officialConversationId, connectionId: official.id, providerId: `reply-${sequence++}`, quotedId: sharedId, direction: "outbound", type: "text", text: "Resposta", sentAt: new Date() } });
    const response = await inbox.messages(orgA, `client:${clientId}`, { limit: 40 });
    expect(response.items.find(item => item.id === reply.id)?.quoted?.text).toBe("Original oficial");
    await prisma.whatsappMessage.update({ where: { id: original.id }, data: { deletedAt: new Date(), mediaThumb: "private-thumbnail" } });
    const after = await inbox.messages(orgA, `client:${clientId}`, { limit: 40 });
    expect(after.items.find(item => item.id === reply.id)?.quoted).toMatchObject({ text: null, mediaThumb: null });
  });
  it("oculta conteúdo de mensagem apagada e payload privado de comando", async () => {
    const message = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgA, conversationId: officialConversationId } });
    await prisma.whatsappMessage.update({ where: { id: message.id }, data: { deletedAt: new Date(), text: "Conteúdo privado apagado", mediaKey: "private/object", mediaFilename: "private.pdf" } });
    await prisma.officialSendCommand.create({ data: { id: `command-${sequence++}`, organizationId: orgA, connectionId: official.id, messageId: message.id, actorUserId: userId, identityId: "fixture-identity", idempotencyKey: `inbox-command-${sequence++}`, requestHash: "fixture-hash", request: { text: "private-request-payload" }, payload: { text: "private-provider-payload" }, status: "uncertain", safeError: "Resultado incerto" } });
    const response = await app.inject({ method: "GET", url: `/v1/whatsapp/inbox/contact:${contactId}/messages`, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("Conteúdo privado apagado");
    expect(response.body).not.toContain("private/object");
    expect(response.body).not.toContain("private.pdf");
    expect(response.body).not.toContain("private-request-payload");
    expect(response.body).not.toContain("private-provider-payload");
    expect(response.json().items[0].command).toMatchObject({ status: "uncertain", safeError: "Resultado incerto" });
  });
});
