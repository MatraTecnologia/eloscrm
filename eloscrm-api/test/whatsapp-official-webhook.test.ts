import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { env } from "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { capture } from "../src/modules/whatsapp-official/webhook.repo.js";
import { processEvent, dispatchDueEvents } from "../src/modules/whatsapp-official/webhook.service.js";
import * as journal from "../src/modules/whatsapp-official/webhook.repo.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let otherCookie: string;
let userId: string;
let connectionId: string;
let wabaId: string;
let phoneNumberId: string;
let businessPortfolioId: string;
const now = new Date();
const timestamp = String(Math.floor(now.getTime() / 1000));

beforeAll(async () => {
  app = await makeApp();
  ({ orgId, cookie } = await signUpWithOrg(app, `official-${randomUUID()}@eloscrm.test`, `official-${randomUUID()}`));
  userId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId }, select: { userId: true } })).userId;
  ({ cookie: otherCookie } = await signUpWithOrg(app, `official-other-${randomUUID()}@eloscrm.test`, `official-other-${randomUUID()}`));
  const fixture = await createOfficialConnectionFixture(orgId);
  connectionId = fixture.connection.id;
  wabaId = fixture.input.wabaId;
  phoneNumberId = fixture.input.phoneNumberId;
  businessPortfolioId = fixture.input.businessPortfolioId;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const valueOf = (fields: Record<string, unknown>) => ({ messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, ...fields });
const envelope = (field: string, fields: Record<string, unknown>, accountId = wabaId) => ({ object: "whatsapp_business_account", entry: [{ id: accountId, changes: [{ field, value: valueOf(fields) }] }] });
const message = (id = randomUUID(), sender = randomUUID(), extra: Record<string, unknown> = {}) => ({ id, from_user_id: sender, type: "text", timestamp, text: { body: "Mensagem fictícia de teste" }, ...extra });
const postRaw = (raw: string, signature?: string) => app.inject({
  method: "POST", url: "/webhooks/whatsapp-official", payload: raw,
  headers: { "content-type": "application/json", "x-hub-signature-256": signature ?? `sha256=${createHmac("sha256", env.META_WHATSAPP_APP_SECRET!).update(raw).digest("hex")}` },
});
const ingest = async (field: string, fields: Record<string, unknown>) => {
  await capture(envelope(field, fields), now);
  const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { organizationId: orgId, field, payload: { equals: valueOf(fields) as never } } });
  await processEvent(event.id);
  return prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
};

describe("webhook oficial", () => {
  it("verifica o desafio sem sessão e recusa token inválido", async () => {
    const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN!, "hub.challenge": "123456789" });
    const response = await app.inject({ method: "GET", url: `/webhooks/whatsapp-official?${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("123456789");
    query.set("hub.verify_token", randomUUID());
    expect((await app.inject({ method: "GET", url: `/webhooks/whatsapp-official?${query}` })).statusCode).toBe(403);
  });

  it("HMAC usa os bytes originais e não a serialização de JSON", async () => {
    const body = envelope("messages", { messages: [message()] });
    const compact = JSON.stringify(body);
    const formatted = JSON.stringify(body, null, 2);
    const wrongSignature = `sha256=${createHmac("sha256", env.META_WHATSAPP_APP_SECRET!).update(compact).digest("hex")}`;
    expect((await postRaw(formatted, wrongSignature)).statusCode).toBe(403);
    expect((await postRaw(formatted)).statusCode).toBe(200);
    expect((await postRaw(compact, "sha256=invalid")).statusCode).toBe(403);
  });

  it("guarda todas as mudanças e deduplica reentregas com outra ordem de chaves", async () => {
    const first = envelope("messages", { messages: [message()] });
    const second = envelope("smb_message_echoes", { message_echoes: [message(randomUUID(), randomUUID(), { to: "5543999998888" })] });
    const batch = { ...first, entry: [...first.entry, ...second.entry] };
    const before = await prisma.officialWebhookEvent.count({ where: { organizationId: orgId } });
    expect((await postRaw(JSON.stringify(batch))).statusCode).toBe(200);
    expect((await postRaw(JSON.stringify({ entry: batch.entry, object: batch.object }))).statusCode).toBe(200);
    expect(await prisma.officialWebhookEvent.count({ where: { organizationId: orgId } })).toBe(before + 2);
  });

  it("não confirma evento quando a persistência falha", async () => {
    const captureMock = vi.spyOn(journal, "capture").mockRejectedValueOnce(new Error("Erro fictício de persistência"));
    try { expect((await postRaw(JSON.stringify(envelope("messages", { messages: [message()] })))).statusCode).toBe(503); }
    finally { captureMock.mockRestore(); }
  });

  it("conexão desconhecida ou WABA incompatível fica pendente, sem atribuir tenant", async () => {
    const body = envelope("messages", { messages: [message()] }, "999999999999999999");
    expect((await postRaw(JSON.stringify(body))).statusCode).toBe(200);
    const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { wabaId: "999999999999999999" } });
    await processEvent(event.id);
    const stored = await prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.organizationId).toBeNull();
    expect(stored.connectionId).toBeNull();
    expect(stored.status).toBe("unresolved");
  });

  it("campos novos ficam guardados para revisão em vez de desaparecer", async () => {
    const event = await ingest("future_event", { opaque: randomUUID() });
    expect(event.status).toBe("unsupported");
    expect(event.payload).toEqual(valueOf({ opaque: (event.payload as Record<string, unknown>).opaque }));
  });

  it("BSUID sem telefone recebe uma mensagem e janela sem duplicar na concorrência", async () => {
    const raw = message();
    await capture(envelope("messages", { messages: [raw] }), now);
    const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { payload: { equals: valueOf({ messages: [raw] }) as never } } });
    await Promise.all([processEvent(event.id), processEvent(event.id), processEvent(event.id)]);
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: raw.id }, include: { conversation: true } });
    expect(stored.conversation.phone).toBeNull();
    expect(stored.conversation.unreadCount).toBe(1);
    expect(stored.origin).toBe("cloud_api");
    expect(stored.conversation.serviceWindowExpiresAt?.getTime()).toBe(Number(timestamp) * 1000 + 86_400_000);
    expect(await prisma.whatsappMessage.count({ where: { connectionId, providerMessageId: raw.id } })).toBe(1);
  });

  it("eco do celular e histórico se conciliam sem janela ou não lidos", async () => {
    const id = randomUUID();
    const recipient = "5543999998877";
    const raw = message(id, randomUUID(), { from: "5543999888000", to: recipient });
    delete (raw as Record<string, unknown>).from_user_id;
    expect((await ingest("history", { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 10 }, threads: [{ id: recipient, messages: [raw] }] }] })).status).toBe("processed");
    expect((await ingest("smb_message_echoes", { message_echoes: [raw] })).status).toBe("processed");
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: id }, include: { conversation: true } });
    expect(stored.direction).toBe("outbound");
    expect(stored.conversation.unreadCount).toBe(0);
    expect(stored.conversation.serviceWindowExpiresAt).toBeNull();
    expect(await prisma.whatsappMessage.count({ where: { connectionId, providerMessageId: id } })).toBe(1);
  });

  it("status anterior à mensagem é conciliado e leitura não regride", async () => {
    const id = randomUUID();
    const pricing = { billable: true, category: "utility", pricing_model: "PMP" };
    expect((await ingest("messages", { statuses: [{ id, status: "read", timestamp, pricing }] })).status).toBe("processed");
    await ingest("smb_message_echoes", { message_echoes: [message(id, randomUUID(), { to: "5543999998866" })] });
    await ingest("messages", { statuses: [{ id, status: "sent", timestamp }] });
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: id } });
    expect(stored.status).toBe("read");
    expect((await prisma.officialDeliveryReceipt.findFirstOrThrow({ where: { connectionId, externalMessageId: id, status: "read" } })).pricing).toEqual(pricing);
  });

  it("eventos diferentes da mesma mensagem não repetem contador ou janela", async () => {
    const sender = randomUUID();
    const latest = message(randomUUID(), sender);
    await ingest("messages", { messages: [latest] });
    await ingest("messages", { messages: [{ ...latest, extra: "reentrega" }] });
    await ingest("messages", { messages: [message(randomUUID(), sender, { timestamp: String(Number(timestamp) - 3600) })] });
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: latest.id }, include: { conversation: true } });
    expect(stored.conversation.unreadCount).toBe(2);
    expect(stored.conversation.lastCustomerMessageAt?.getTime()).toBe(Number(timestamp) * 1000);
    expect(stored.conversation.serviceWindowExpiresAt?.getTime()).toBe(Number(timestamp) * 1000 + 86_400_000);
  });

  it("aliases do mesmo contato são conciliados somente pela identidade do remetente", async () => {
    const sender = randomUUID();
    const phone = "5543999998833";
    const first = message(randomUUID(), sender, { from: phone });
    const second = message(randomUUID(), sender);
    await ingest("messages", { messages: [first], contacts: [{ user_id: sender, wa_id: phone, profile: { name: "Remetente fictício" } }] });
    await ingest("messages", { messages: [second] });
    const rows = await prisma.whatsappMessage.findMany({ where: { connectionId, providerMessageId: { in: [first.id, second.id] } } });
    expect(new Set(rows.map(row => row.conversationId)).size).toBe(1);
    const identities = await prisma.contactIdentity.findMany({ where: { organizationId: orgId, value: { in: [phone, sender] } } });
    expect(new Set(identities.map(identity => identity.contactId)).size).toBe(1);
  });

  it("mudança de BSUID e parent conserva o contato e se audita uma única vez", async () => {
    const previous = randomUUID();
    const current = randomUUID();
    const parentPrevious = randomUUID();
    const parentCurrent = randomUUID();
    const first = message(randomUUID(), previous, { timestamp: String(Number(timestamp) - 120), from_parent_user_id: parentPrevious });
    await ingest("messages", { messages: [first] });
    const original = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: first.id } });
    const before = await prisma.auditEvent.count({ where: { organizationId: orgId, action: "WEBHOOK_RECONCILED" } });
    const update = { timestamp, user_id: { previous, current }, parent_user_id: { previous: parentPrevious, current: parentCurrent } };
    expect((await ingest("user_id_update", { user_id_update: [update] })).status).toBe("processed");
    expect((await ingest("user_id_update", { user_id_update: [{ ...update, extra: "reentrega" }] })).status).toBe("processed");
    const last = message(randomUUID(), current, { from_parent_user_id: parentCurrent });
    await ingest("messages", { messages: [last] });
    expect((await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: last.id } })).conversationId).toBe(original.conversationId);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: "WEBHOOK_RECONCILED" } })).toBe(before + 1);
    expect((await prisma.whatsappMessage.findFirstOrThrow({ where: { id: original.id } })).recipientIdentity).toEqual(original.recipientIdentity);
  });

  it("conflito de aliases fica visível sem sobrescrever outro contato", async () => {
    const previous = randomUUID();
    const current = randomUUID();
    await ingest("messages", { messages: [message(randomUUID(), previous), message(randomUUID(), current)] });
    const event = await ingest("user_id_update", { user_id_update: [{ timestamp, user_id: { previous, current } }] });
    expect(event.status).toBe("failed");
    expect(event.lastErrorCode).toBe("OFFICIAL_IDENTITY_CONFLICT");
    expect((await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, value: previous } })).validUntil).toBeNull();
  });

  it("mídia complementar do histórico enriquece o placeholder sem nova bolha", async () => {
    const id = randomUUID();
    const recipient = "5543999998822";
    const placeholder = { id, from: recipient, timestamp, type: "media_placeholder" };
    await ingest("history", { history: [{ threads: [{ id: recipient, messages: [placeholder] }] }] });
    const image = { ...placeholder, type: "image", image: { id: "123456789", caption: "Imagem fictícia", mime_type: "image/jpeg" } };
    await ingest("history", { history: [{ threads: [{ id: recipient, messages: [image] }] }] });
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: id }, include: { conversation: true } });
    expect(stored.type).toBe("image");
    expect(stored.officialMediaId).toBe("123456789");
    expect(stored.conversation.unreadCount).toBe(0);
    expect(stored.conversation.serviceWindowExpiresAt).toBeNull();
    expect(await prisma.whatsappMessage.count({ where: { connectionId, providerMessageId: id } })).toBe(1);
  });

  it("eco não sobrescreve conteúdo ou autoria já registrados pelo CRM", async () => {
    const raw = message(randomUUID(), randomUUID(), { to: "5543999998811" });
    await ingest("smb_message_echoes", { message_echoes: [raw] });
    await prisma.whatsappMessage.updateMany({ where: { connectionId, providerMessageId: raw.id }, data: { origin: "cloud_api", sentById: userId, sentByApi: true } });
    await ingest("smb_message_echoes", { message_echoes: [{ ...raw, text: { body: "Eco fictício divergente" } }] });
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: raw.id } });
    expect(stored.origin).toBe("cloud_api");
    expect(stored.sentById).toBe(userId);
    expect(stored.text).toBe("Mensagem fictícia de teste");
  });

  it("excluir a organização elimina journal, mensagens, identidades e receipts", async () => {
    const organization = await prisma.organization.create({ data: { name: "Tenant temporário", slug: `purge-official-${randomUUID()}` } });
    const fixture = await createOfficialConnectionFixture(organization.id);
    const raw = message();
    const body = { object: "whatsapp_business_account", entry: [{ id: fixture.input.wabaId, changes: [{ field: "messages", value: {
      metadata: { phone_number_id: fixture.input.phoneNumberId }, messages: [raw], statuses: [{ id: raw.id, status: "read", timestamp }],
    } }] }] };
    await capture(body, now);
    const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { organizationId: organization.id } });
    await processEvent(event.id);
    expect((await prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("processed");
    await prisma.organization.delete({ where: { id: organization.id } });
    expect(await prisma.officialWebhookEvent.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await prisma.officialDeliveryReceipt.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await prisma.whatsappMessage.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await prisma.conversation.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  it("histórico recusado não cria mensagens, leads ou negócios", async () => {
    const before = await prisma.client.count({ where: { organizationId: orgId } });
    expect((await ingest("history", { history: [{ errors: [{ code: 2593109 }] }] })).status).toBe("processed");
    await ingest("smb_app_state_sync", { state_sync: [{ type: "contact", action: "add", contact: { full_name: "Contato fictício", phone_number: "5543999998855" }, metadata: { timestamp } }] });
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(before);
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("falha parcial é recuperável sem duplicar as mensagens que já passaram", async () => {
    const good = message();
    const bad = message(randomUUID(), randomUUID(), { timestamp: "invalid" });
    const event = await ingest("messages", { messages: [good, bad] });
    expect(event.status).toBe("failed");
    await prisma.officialWebhookEvent.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(0) } });
    await dispatchDueEvents();
    expect(await prisma.whatsappMessage.count({ where: { connectionId, providerMessageId: good.id } })).toBe(1);
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: good.id }, include: { conversation: true } });
    expect(stored.conversation.unreadCount).toBe(1);
  });

  it("item inválido não impede mensagem e status saudáveis posteriores", async () => {
    const good = message();
    const bad = message(randomUUID(), randomUUID(), { timestamp: "invalid" });
    const event = await ingest("messages", { messages: [bad, good], statuses: [{ id: good.id, status: "read", timestamp }] });
    expect(event.status).toBe("failed");
    expect(event.processedItemCount).toBe(2);
    expect(event.failedItemCount).toBe(1);
    expect(await prisma.whatsappMessage.count({ where: { connectionId, providerMessageId: good.id } })).toBe(1);
    expect(await prisma.officialDeliveryReceipt.count({ where: { connectionId, externalMessageId: good.id } })).toBe(1);
  });

  it("disputa entre conexões do mesmo portfolio não aposenta o alias perdedor", async () => {
    const second = await createOfficialConnectionFixture(orgId, { businessPortfolioId });
    const previousA = randomUUID();
    const previousB = randomUUID();
    const current = randomUUID();
    await ingest("messages", { messages: [message(randomUUID(), previousA)] });
    const fieldsB = { metadata: { phone_number_id: second.input.phoneNumberId }, messages: [message(randomUUID(), previousB)] };
    await capture(envelope("messages", fieldsB, second.input.wabaId), now);
    await processEvent((await prisma.officialWebhookEvent.findFirstOrThrow({ where: { connectionId: second.connection.id } })).id);
    await capture(envelope("user_id_update", { user_id_update: [{ timestamp, user_id: { previous: previousA, current } }] }), now);
    await capture(envelope("user_id_update", { metadata: { phone_number_id: second.input.phoneNumberId }, user_id_update: [{ timestamp, user_id: { previous: previousB, current } }] }, second.input.wabaId), now);
    const events = await prisma.officialWebhookEvent.findMany({ where: { organizationId: orgId, field: "user_id_update", status: "pending", connectionId: { in: [connectionId, second.connection.id] } } });
    expect(events).toHaveLength(2);
    await Promise.all(events.map(event => processEvent(event.id)));
    const outcomes = await prisma.officialWebhookEvent.findMany({ where: { id: { in: events.map(event => event.id) } } });
    expect(outcomes.filter(event => event.status === "processed")).toHaveLength(1);
    expect(outcomes.filter(event => event.status === "failed")).toHaveLength(1);
    const winner = await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, kind: "bsuid", value: current } });
    const previousAliases = await prisma.contactIdentity.findMany({ where: { organizationId: orgId, value: { in: [previousA, previousB] } } });
    for (const alias of previousAliases) expect(alias.validUntil === null).toBe(alias.contactId !== winner.contactId);
  });

  it("recupera trabalho que ficou sem enqueue e lease de processo interrompido", async () => {
    const raw = message();
    await capture(envelope("messages", { messages: [raw] }), now);
    const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { payload: { equals: valueOf({ messages: [raw] }) as never } } });
    await prisma.officialWebhookEvent.update({ where: { id: event.id }, data: { status: "processing", leaseToken: randomUUID(), leaseExpiresAt: new Date(0) } });
    await dispatchDueEvents();
    expect((await prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("processed");
  });

  it("journal e replay são exclusivos do gestor e não expõem payload", async () => {
    const event = await ingest("future_event", { privateContent: "Texto fictício" });
    const url = `/v1/whatsapp/events/${event.id}/replay`;
    expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie: otherCookie }, payload: {} })).statusCode).toBe(404);
    const response = await app.inject({ method: "GET", url: "/v1/whatsapp/events", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("privateContent");
    expect(response.body).not.toContain("Texto fictício");
    await prisma.member.updateMany({ where: { organizationId: orgId, userId }, data: { role: "member" } });
    expect((await app.inject({ method: "POST", url, headers: { cookie }, payload: {} })).statusCode).toBe(403);
    await prisma.member.updateMany({ where: { organizationId: orgId, userId }, data: { role: "owner" } });
  });

  it("rotas de atendimento uazapi recusam conversas oficiais", async () => {
    const raw = message();
    await ingest("messages", { messages: [raw] });
    const stored = await prisma.whatsappMessage.findFirstOrThrow({ where: { connectionId, providerMessageId: raw.id } });
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/conversations/${stored.conversationId}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/conversations/${stored.conversationId}/messages`, headers: { cookie }, payload: { text: "Teste fictício" } })).statusCode).toBe(404);
  });
});
