import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, type ChannelConnection } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import { ingestReceipt } from "../src/modules/whatsapp-official/receipts.repo.js";
import * as service from "../src/modules/whatsapp-costs/costs.service.js";
import type { Period, RateInput } from "../src/modules/whatsapp-costs/costs.schema.js";

let app: FastifyInstance;
let orgId: string;
let otherOrg: string;
let cookie: string;
let actorId: string;
let channel: ChannelConnection;
let period: Period;
let rate: RateInput;
const at = new Date("2026-10-06T12:00:00.000Z");
const headers = () => ({ cookie, origin: env.WEB_ORIGIN });
beforeAll(async () => {
  app = await makeApp(); const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `finance-${suffix}@eloscrm.test`, `finance-${suffix}`));
  ({ orgId: otherOrg } = await signUpWithOrg(app, `finance-other-${suffix}@eloscrm.test`, `finance-other-${suffix}`));
  actorId = (await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie } })).json().user.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  const fixture = await createOfficialConnectionFixture(orgId);
  channel = await prisma.channelConnection.update({ where: { id: fixture.connection.id }, data: { currency: "USD" } });
  period = { connectionId: channel.id, start: "2026-10-01T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z" };
  rate = { connectionId: channel.id, country: "US", category: "MARKETING", pricingType: "REGULAR", unitRate: "0.0000012345", validFrom: "2026-10-01T00:00:00.000Z", validUntil: "2026-11-01T00:00:00.000Z", volumeFrom: 0, volumeUntil: null, sourceUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing" };
});
const createCost = async (phone: string, amount: string) => {
  const conversationId = await ingestMessage(channel, { id: randomUUID(), from: phone, type: "text", text: { body: "Fixture financeiro" }, timestamp: String(at.getTime() / 1000) }, [], "cloud_api", at);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId, id: conversationId } });
  const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, connectionId: channel.id, conversationId, providerId: randomUUID(), type: "text", direction: "outbound", origin: "cloud_api", status: "delivered", sentAt: at } });
  await prisma.messageCost.create({ data: { organizationId: orgId, connectionId: channel.id, messageId: message.id, deliveredAt: at, category: "MARKETING", pricingType: "REGULAR", currency: "USD", amount: new Prisma.Decimal(amount), state: "estimated_base", receiptId: randomUUID(), revision: 1, pricingHash: randomUUID() } });
  return { conversation, message };
};

describe("financeiro oficial declarado e recortes locais", () => {
  it("importa lotes atomicamente e recusa sobreposição dentro do próprio lote", async () => {
    const { connectionId: _connectionId, ...row } = rate;
    await expect(service.importRates(orgId, { connectionId: channel.id, rows: [row, { ...row, unitRate: "0.2" }] }, actorId)).rejects.toMatchObject({ code: "COST_RATE_OVERLAP" });
    expect(await prisma.officialRate.count({ where: { organizationId: orgId, wabaId: channel.wabaId! } })).toBe(0);
    const rows = await service.importRates(orgId, { connectionId: channel.id, rows: [row, { ...row, country: "AR" }] }, actorId);
    expect(rows.map(item => item.currency)).toEqual(["USD", "USD"]);
    expect(rows.map(item => item.unitRate)).toEqual([rate.unitRate, rate.unitRate]);
    const response = await app.inject({ method: "POST", url: "/v1/whatsapp/costs/rates/import", headers: headers(), payload: { connectionId: channel.id, rows: [{ ...row, currency: "BRL" }] } });
    expect(response.statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/costs/rates/import", headers: headers(), payload: { connectionId: channel.id, rows: Array.from({ length: 101 }, () => row) } })).statusCode).toBe(422);
  });
  it("recorta contato/atendimento sem mudar o agregado da WABA e rejeita recurso estrangeiro", async () => {
    const first = await createCost("5543999911201", "0.0000012345"); await createCost("5543999911202", "0.2");
    await prisma.costAnalyticsSnapshot.create({ data: { organizationId: orgId, wabaId: channel.wabaId!, start: new Date(period.start), end: new Date(period.end), currency: "USD", status: "available", total: new Prisma.Decimal("10"), volume: 100, points: [], revision: 1, lastAttemptAt: new Date() } });
    const byContact = await service.report(orgId, { ...period, contactId: first.conversation.messagingContactId! });
    const byConversation = await service.report(orgId, { ...period, conversationId: first.conversation.id });
    expect(byContact.subtotals).toEqual([{ currency: "USD", amount: "0.0000012345", known: 1 }]);
    expect(byConversation.subtotals).toEqual(byContact.subtotals);
    expect(byContact.analytics?.total).toBe("10");
    const foreign = await prisma.messagingContact.create({ data: { organizationId: otherOrg } });
    await expect(service.report(orgId, { ...period, contactId: foreign.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.report(orgId, { ...period, conversationId: "unknown" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.report(orgId, { ...period, campaignId: "unknown" })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("atribui somente mensagens diretamente ligadas à campanha, sem distribuir o agregado", async () => {
    const first = await createCost("5543999911203", "0.03"); await createCost("5543999911204", "0.2");
    const campaign = await prisma.officialCampaign.create({ data: { organizationId: orgId, connectionId: channel.id, pipelineId: randomUUID(), name: "Campanha financeira fictícia", actorUserId: actorId, actorName: "Gestor fictício", idempotencyKey: randomUUID(), requestHash: randomUUID(), input: {}, snapshot: {}, previewHash: randomUUID() } });
    const recipient = await prisma.officialCampaignRecipient.create({ data: { organizationId: orgId, campaignId: campaign.id, clientId: randomUUID(), dealId: randomUUID(), contactId: first.conversation.messagingContactId!, identityId: randomUUID(), identityHash: randomUUID(), clientName: "Contato fictício", parameters: {}, costSnapshot: {} } });
    await prisma.officialSendCommand.create({ data: { id: randomUUID(), organizationId: orgId, connectionId: channel.id, messageId: first.message.id, actorUserId: actorId, identityId: recipient.identityId, idempotencyKey: randomUUID(), requestHash: randomUUID(), request: {}, payload: {}, status: "accepted", campaignRecipientId: recipient.id } });
    const result = await service.report(orgId, { ...period, campaignId: campaign.id });
    expect(result.subtotals).toEqual([{ currency: "USD", amount: "0.03", known: 1 }]);
    expect(result.counts.official).toBe(1);
    expect(result.items[0]?.messageId).toBe(first.message.id);
  });
  it("concilia com Decimal e preserva snapshot, ator e versões imutáveis", async () => {
    await createCost("5543999911211", "0.0000012345");
    await prisma.costAnalyticsSnapshot.create({ data: { organizationId: orgId, wabaId: channel.wabaId!, start: new Date(period.start), end: new Date(period.end), currency: "USD", status: "available", total: new Prisma.Decimal("10.0000012345"), volume: 100, points: [], revision: 1, lastAttemptAt: new Date() } });
    const input = { ...period, documentReference: "Fatura fictícia 1", reportedTotal: "11.0000012345", declaredFees: "0.3", declaredTaxes: "0.2", note: "Conferência declarada" };
    const first = await service.reconcile(orgId, input, actorId);
    expect(first.createdById).toBe(actorId); expect(first.evidence).toBe("manager_declared");
    expect(first.snapshot).toMatchObject({ differenceFromMeta: "0.5", differenceFromLocalEstimate: "10.5", localScope: "connection", documentScope: "waba", unresolved: 0 });
    await prisma.costAnalyticsSnapshot.updateMany({ where: { organizationId: orgId, wabaId: channel.wabaId! }, data: { total: new Prisma.Decimal("20"), revision: 2 } });
    await service.reconcile(orgId, { ...input, documentReference: "Correção explícita" }, actorId);
    const records = await service.listReconciliations(orgId, period);
    expect(records).toHaveLength(2);
    expect(records.find(item => item.id === first.id)?.snapshot).toMatchObject({ differenceFromMeta: "0.5", analytics: { total: "10.0000012345", revision: 1 } });
    expect(await prisma.messageCost.count({ where: { organizationId: orgId, connectionId: channel.id } })).toBe(1);
  });
  it("mantém diferenças indisponíveis sem métrica ou com moeda incompatível e valida total externo", async () => {
    const input = { ...period, documentReference: "Fatura fictícia", reportedTotal: "1" };
    const saved = await service.reconcile(orgId, input, actorId);
    expect(saved.snapshot).toMatchObject({ differenceFromMeta: null, differenceFromLocalEstimate: null });
    expect(saved.declaredFees).toBeNull(); expect(saved.declaredTaxes).toBeNull();
    await expect(service.reconcile(orgId, { ...input, declaredFees: "2" }, actorId)).rejects.toMatchObject({ code: "COST_INVOICE_COMPONENTS" });
    await expect(service.reconcile(otherOrg, input, actorId)).rejects.toMatchObject({ statusCode: 404 });
    const response = await app.inject({ method: "POST", url: "/v1/whatsapp/costs/reconciliations", headers: headers(), payload: { ...input, differenceFromMeta: "0", createdById: actorId } });
    expect(response.statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/costs/reconciliations", headers: { cookie }, payload: input })).statusCode).toBe(403);
  });
  it("mercado declarado permite país explícito em BSUID sem inferir seu conteúdo", async () => {
    const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, displayName: "Contato de teste" } });
    const identity = await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: channel.id, source: "provider", kind: "bsuid", scope: `business:${channel.businessPortfolioId}`, value: `BR.${randomUUID()}`, validFrom: new Date("2026-10-01T00:00:00.000Z") } });
    await service.addRate(orgId, { ...rate, category: "SERVICE" }, actorId);
    expect((await service.preview(orgId, { connectionId: channel.id, identityId: identity.id, type: "text" })).state).toBe("missing_country");
    await service.setRecipientCountry(orgId, { connectionId: channel.id, identityId: identity.id, country: "US" });
    expect((await service.preview(orgId, { connectionId: channel.id, identityId: identity.id, type: "text" })).amount).toBe(rate.unitRate);
    await expect(service.setRecipientCountry(otherOrg, { connectionId: channel.id, identityId: identity.id, country: "BR" })).rejects.toMatchObject({ statusCode: 404 });
    await service.addRate(orgId, rate, actorId);
    const conversationId = await ingestMessage(channel, { id: randomUUID(), from: "5543999911221", type: "text", text: { body: "Fixture" }, timestamp: String(at.getTime() / 1000) }, [], "cloud_api", at);
    const externalId = `wamid.${randomUUID()}`;
    const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, connectionId: channel.id, conversationId, providerId: externalId, providerMessageId: externalId, type: "text", direction: "outbound", origin: "cloud_api", status: "sent", sentAt: at, recipientIdentity: { identityId: identity.id } } });
    await ingestReceipt(channel, { id: externalId, status: "delivered", timestamp: String(at.getTime() / 1000), pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" } }, new Date());
    expect(await prisma.messageCost.findFirst({ where: { organizationId: orgId, messageId: message.id } })).toMatchObject({ country: "US", state: "estimated_base" });
  });
});
