import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ChannelConnection, WhatsappMessageOrigin } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { phoneKey } from "../src/lib/phone.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import * as repo from "../src/modules/lead-automation/inbound-automation.repo.js";
import { processInboundAutomation } from "../src/modules/lead-automation/inbound-automation.service.js";

let app: FastifyInstance;
let orgId: string;
let userId: string;
let cookie: string;
let foreignCookie: string;
let foreignOrg: string;
let channel: ChannelConnection;
let pipelineId: string;
let stageId: string;
const headers = () => ({ cookie, origin: env.WEB_ORIGIN });
const phone = "5543999911301";
beforeAll(async () => {
  app = await makeApp(); const suffix = randomUUID();
  ({ orgId: foreignOrg, cookie: foreignCookie } = await signUpWithOrg(app, `inbound-other-${suffix}@eloscrm.test`, `inbound-other-${suffix}`));
});
beforeEach(async () => {
  const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `inbound-${suffix}@eloscrm.test`, `inbound-${suffix}`));
  userId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId } })).userId;
  const fixture = await createOfficialConnectionFixture(orgId);
  channel = await prisma.channelConnection.findFirstOrThrow({ where: { organizationId: orgId, id: fixture.connection.id } });
  const pipeline = await prisma.pipeline.create({ data: { organizationId: orgId, name: "Entrada fictícia", stages: { create: { organizationId: orgId, name: "Entrada", position: 0 } } }, include: { stages: true } });
  pipelineId = pipeline.id; stageId = pipeline.stages[0]!.id;
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
const configure = (enabled = true) => prisma.leadAutomation.create({ data: { organizationId: orgId, autoCreateClient: enabled, autoCreateDeal: enabled, pipelineId, stageId, autoAssign: enabled, members: { create: { userId, active: true } } } });
const incoming = async (origin: WhatsappMessageOrigin = "cloud_api", id = randomUUID(), recipient = phone) => {
  const raw = { id, ...(origin === "business_app" ? { to: recipient } : { from: recipient }), type: "text", text: { body: "Mensagem fictícia privada" }, timestamp: String(Math.floor(Date.now() / 1000)) };
  const conversationId = await ingestMessage(channel, raw, [{ wa_id: recipient, profile: { name: "Pessoa fictícia" } }], origin, new Date());
  return { conversationId, message: await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId, connectionId: channel.id, providerMessageId: id } }) };
};
const pending = async (options: { group?: boolean; origin?: WhatsappMessageOrigin; direction?: "inbound" | "outbound"; live?: boolean; conversationId?: string } = {}) => {
  const conversation = options.conversationId ? await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId, id: options.conversationId } }) : await prisma.conversation.create({ data: { organizationId: orgId, connectionId: channel.id, chatid: randomUUID(), phone, waName: "Pessoa fictícia", isGroup: options.group ?? false } });
  const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, connectionId: channel.id, conversationId: conversation.id, providerId: randomUUID(), providerMessageId: randomUUID(), origin: options.origin ?? "cloud_api", direction: options.direction ?? "inbound", type: "text", status: "delivered", sentAt: new Date(), liveReceivedAt: options.live === false ? null : new Date(), automationStatus: "pending", automationNextAttemptAt: new Date(Date.now() - 1000), automationSuggestedName: "Pessoa fictícia" } });
  return { conversation, message };
};

describe("automação oficial inbound persistida", () => {
  it("ingestão live cria lead, negócio e dono uma vez e registra auditoria da automação", async () => {
    await configure(); const id = randomUUID();
    const first = await incoming("cloud_api", id); await incoming("cloud_api", id); await incoming();
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId, id: first.conversationId }, include: { client: true, messagingContact: true } });
    expect(conversation.client).toMatchObject({ name: "Pessoa fictícia", source: "WHATSAPP", ownerId: userId, phoneKey: phoneKey(phone) });
    expect(conversation.messagingContact?.clientId).toBe(conversation.clientId);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.deal.findMany({ where: { organizationId: orgId } })).toEqual([expect.objectContaining({ clientId: conversation.clientId, ownerId: userId, pipelineId, stageId })]);
    expect(await prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, id: first.message.id } })).toMatchObject({ automationStatus: "processed", automationAttempts: 1, automationErrorCode: null });
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, entityType: "CLIENT", entityId: conversation.clientId!, action: "CREATED" } })).toMatchObject({ actorId: null, actorName: "Automação", source: "AUTOMATION" });
  });
  it("processamentos concorrentes da mesma conversa criam somente um cliente e negócio", async () => {
    await configure(); const first = await pending(); const second = await pending({ conversationId: first.conversation.id });
    await Promise.all([repo.process(orgId, first.message.id), repo.process(orgId, first.message.id), repo.process(orgId, second.message.id), repo.process(orgId, second.message.id)]);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.whatsappMessage.findMany({ where: { organizationId: orgId }, select: { automationStatus: true, automationAttempts: true } })).toEqual([expect.objectContaining({ automationStatus: "processed", automationAttempts: 1 }), expect.objectContaining({ automationStatus: "processed", automationAttempts: 1 })]);
    expect(await prisma.leadAutomationMember.findFirst({ where: { userId, automation: { organizationId: orgId } } })).toMatchObject({ lastAssignedAt: expect.any(Date) });
  });
  it("histórico e eco não agendam automação; guarda do processador exclui grupos e eventos sem live", async () => {
    await configure(); const history = await incoming("history"); const echo = await incoming("business_app");
    expect(history.message.automationStatus).toBeNull(); expect(echo.message.automationStatus).toBeNull();
    for (const options of [{ origin: "uazapi" as const }, { group: true }, { origin: "history" as const }, { origin: "business_app" as const, direction: "outbound" as const }, { live: false }, { direction: "outbound" as const }]) {
      const fixture = await pending(options); await repo.process(orgId, fixture.message.id);
      expect(await prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, id: fixture.message.id } })).toMatchObject({ automationStatus: "skipped", automationErrorCode: "AUTOMATION_NOT_LIVE" });
    }
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(0); expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(0);
  });
  it("BSUID sem telefone cria lead e mantém a identidade e o vínculo em mensagens posteriores", async () => {
    await configure(); const bsuid = `opaque.${randomUUID()}`;
    const receive = (id: string) => ingestMessage(channel, { id, from_user_id: bsuid, type: "text", text: { body: "Fixture sem telefone" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [{ user_id: bsuid, profile: { name: "Contato sem telefone" } }], "cloud_api", new Date());
    const conversationId = await receive(randomUUID()); const secondId = await receive(randomUUID()); expect(secondId).toBe(conversationId);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId, id: conversationId }, include: { client: true, messagingContact: { include: { identities: true } } } });
    expect(conversation.client).toMatchObject({ name: "Contato sem telefone", phone: null, phoneKey: null, ownerId: userId });
    expect(conversation.messagingContact?.clientId).toBe(conversation.clientId);
    expect(conversation.messagingContact?.identities).toEqual([expect.objectContaining({ kind: "bsuid", value: bsuid, scope: `business:${channel.businessPortfolioId}` })]);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1); expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(1);
  });
  it("telefone ambíguo mantém os candidatos e sinaliza decisão pendente sem criar lead", async () => {
    await configure(); await prisma.client.createMany({ data: [{ organizationId: orgId, name: "Primeiro candidato", phoneKey: phoneKey(phone) }, { organizationId: orgId, name: "Segundo candidato", phoneKey: phoneKey(phone) }] });
    const fixture = await incoming();
    expect(await prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, id: fixture.message.id } })).toMatchObject({ automationStatus: "skipped", automationErrorCode: "AUTOMATION_AMBIGUOUS_PHONE" });
    expect((await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId, id: fixture.conversationId } })).clientId).toBeNull();
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(2); expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(0);
  });
  it("sem configuração e com chaves desligadas persiste mensagem sem criar cliente", async () => {
    const absent = await incoming(); expect(absent.message.automationStatus).toBe("skipped"); expect(absent.message.automationErrorCode).toBe("AUTOMATION_DISABLED");
    await configure(false); const disabled = await incoming(); expect(disabled.message.automationStatus).toBe("skipped"); expect(disabled.message.automationErrorCode).toBe("AUTOMATION_CLIENT_DISABLED");
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(0);
  });
  it("falha técnica preserva intenção e erro seguro no banco; nova tentativa posterior processa uma vez", async () => {
    await configure(); const fixture = await pending();
    const failure = vi.spyOn(repo, "process").mockRejectedValueOnce(new Error("Conteúdo técnico privado simulado"));
    await processInboundAutomation({ organizationId: orgId, messageId: fixture.message.id }); failure.mockRestore();
    const saved = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId, id: fixture.message.id } });
    expect(saved).toMatchObject({ automationStatus: "failed", automationAttempts: 1, automationErrorCode: "AUTOMATION_PROCESSING_FAILED", automationProcessedAt: null });
    expect(saved.automationNextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await repo.due()).some(row => row.id === fixture.message.id)).toBe(false);
    await prisma.whatsappMessage.update({ where: { id: fixture.message.id }, data: { automationNextAttemptAt: new Date(Date.now() - 1000) } });
    expect((await repo.due()).some(row => row.id === fixture.message.id)).toBe(true);
    await processInboundAutomation({ organizationId: orgId, messageId: fixture.message.id });
    await processInboundAutomation({ organizationId: orgId, messageId: fixture.message.id });
    expect(await prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, id: fixture.message.id } })).toMatchObject({ automationStatus: "processed", automationAttempts: 2, automationErrorCode: null });
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1); expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(1);
  });
  it("listagem e retry exigem gestor, tenant e origem; retry auditado preserva body estrito", async () => {
    await configure(); const fixture = await pending(); await repo.failed(orgId, fixture.message.id);
    const url = `/v1/whatsapp/automations/${fixture.message.id}/retry`;
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/automations" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/automations", headers: { cookie: foreignCookie } })).json()).toEqual([]);
    expect((await app.inject({ method: "POST", url, headers: { cookie: foreignCookie, origin: env.WEB_ORIGIN }, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url, headers: { cookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: { ...headers(), origin: "https://other.eloscrm.test" }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: headers(), payload: { organizationId: foreignOrg } })).statusCode).toBe(422);
    const member = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, userId } });
    await prisma.member.update({ where: { id: member.id }, data: { role: "member" } });
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/automations", headers: headers() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: headers(), payload: {} })).statusCode).toBe(403);
    await prisma.member.update({ where: { id: member.id }, data: { role: "owner" } });
    const list = await app.inject({ method: "GET", url: "/v1/whatsapp/automations", headers: headers() }); expect(list.statusCode).toBe(200); expect(list.body).not.toContain("Mensagem fictícia privada");
    expect((await app.inject({ method: "POST", url, headers: headers(), payload: {} })).statusCode).toBe(200);
    expect(await prisma.whatsappMessage.findFirst({ where: { organizationId: orgId, id: fixture.message.id } })).toMatchObject({ automationStatus: "processed" });
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, entityType: "WHATSAPP_MESSAGE", entityId: fixture.message.id, actorId: userId } })).toMatchObject({ action: "UPDATED" });
    expect((await app.inject({ method: "POST", url, headers: headers(), payload: {} })).statusCode).toBe(409);
  });
});
