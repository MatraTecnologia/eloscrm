import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ChannelConnection } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import { ingestReceipt } from "../src/modules/whatsapp-official/receipts.repo.js";
import * as costs from "../src/modules/whatsapp-costs/costs.service.js";
import { syncAnalytics } from "../src/modules/whatsapp-costs/analytics.service.js";
import { assessPeriod } from "../src/modules/whatsapp-costs/assessment.repo.js";
import type { RateInput, Period } from "../src/modules/whatsapp-costs/costs.schema.js";

vi.mock("../src/lib/whatsapp-official/graph.js", async importOriginal => ({ ...await importOriginal<object>(), requestGraph: vi.fn() }));
import { requestGraph } from "../src/lib/whatsapp-official/graph.js";
const graph = vi.mocked(requestGraph);
let app: FastifyInstance;
let orgId: string;
let foreignOrg: string;
let cookie: string;
let foreignCookie: string;
let actorId: string;
let channel: ChannelConnection;
let conversationId: string;
let period: Period;
let rate: RateInput;
const at = new Date("2026-10-06T12:00:00.000Z");
const headers = () => ({ cookie, origin: env.WEB_ORIGIN });
beforeAll(async () => {
  app = await makeApp(); const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `costs-${suffix}@eloscrm.test`, `costs-${suffix}`));
  ({ orgId: foreignOrg, cookie: foreignCookie } = await signUpWithOrg(app, `costs-other-${suffix}@eloscrm.test`, `costs-other-${suffix}`));
  actorId = (await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie } })).json().user.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  graph.mockReset();
  const fixture = await createOfficialConnectionFixture(orgId);
  channel = await prisma.channelConnection.update({ where: { id: fixture.connection.id }, data: { currency: "USD" } });
  conversationId = await ingestMessage(channel, { id: randomUUID(), from: "5543999912345", type: "text", text: { body: "Fixture financeiro" }, timestamp: String(at.getTime() / 1000) }, [], "cloud_api", at);
  period = { connectionId: channel.id, start: "2026-10-01T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z" };
  rate = { connectionId: channel.id, country: "BR", category: "MARKETING", pricingType: "REGULAR", unitRate: "0.0000012345", validFrom: "2026-10-01T00:00:00.000Z", validUntil: "2026-11-01T00:00:00.000Z", volumeFrom: 0, volumeUntil: null, sourceUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing" };
});
const outbound = async (origin: "cloud_api" | "business_app" | "history" = "cloud_api", aliases: unknown = [{ kind: "phone", value: "5543999912345" }]) => {
  const externalId = `wamid.${randomUUID()}`;
  const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, conversationId, connectionId: channel.id, providerId: externalId, providerMessageId: externalId, type: "text", direction: "outbound", origin, text: "Conteúdo fictício privado", status: "sent", sentAt: at, recipientIdentity: aliases as never } });
  return message;
};
const receipt = (id: string, status = "delivered", pricing?: Record<string, unknown>, timestamp = at.getTime() / 1000) => ingestReceipt(channel, { id, status, timestamp: String(timestamp), ...(pricing ? { pricing } : {}) }, new Date());
const billed = { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" };

describe("custos oficiais, sem envios reais", () => {
  it("exige owner/admin, tenant e origem; valida dados e não aceita total do cliente", async () => {
    const url = `/v1/whatsapp/costs?${new URLSearchParams(period)}`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url, headers: { cookie: foreignCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/costs/rates", headers: { ...headers(), origin: "https://foreign.eloscrm.test" }, payload: rate })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/costs/rates", headers: headers(), payload: { ...rate, total: 0 } })).statusCode).toBe(422);
    const member = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, userId: actorId } });
    await prisma.member.update({ where: { id: member.id }, data: { role: "member" } });
    expect((await app.inject({ method: "GET", url, headers: headers() })).statusCode).toBe(403);
    await prisma.member.update({ where: { id: member.id }, data: { role: "owner" } });
    expect((await prisma.messageCost.findMany({ where: { organizationId: foreignOrg } }))).toHaveLength(0);
  });
  it("sent/aceitação não apuram; entrega e leitura repetidas não duplicam valor", async () => {
    await costs.addRate(orgId, rate, actorId); const message = await outbound();
    await receipt(message.providerMessageId!, "sent", billed);
    expect(await prisma.messageCost.count({ where: { organizationId: orgId, messageId: message.id } })).toBe(0);
    await receipt(message.providerMessageId!, "delivered", billed);
    await receipt(message.providerMessageId!, "delivered", billed);
    await receipt(message.providerMessageId!, "read", billed, at.getTime() / 1000 + 10);
    const saved = await prisma.messageCost.findFirstOrThrow({ where: { organizationId: orgId, messageId: message.id } });
    expect(saved.amount?.toString()).toBe(rate.unitRate);
    expect(saved.revision).toBe(1);
    expect((await costs.report(orgId, period)).subtotals).toEqual([{ currency: "USD", amount: rate.unitRate, known: 1 }]);
  });
  it("sem pricing, país BSUID ou moeda mantém valor desconhecido; CBP não vira tarifa por mensagem", async () => {
    const noPricing = await outbound(); await receipt(noPricing.providerMessageId!);
    const bsuid = await outbound("cloud_api", [{ kind: "bsuid", value: "BR.fixture" }]); await receipt(bsuid.providerMessageId!, "delivered", billed);
    const cbp = await outbound(); await receipt(cbp.providerMessageId!, "delivered", { ...billed, pricing_model: "CBP" });
    expect((await costs.report(orgId, period)).items.map(item => item.state).sort()).toEqual(["missing_country", "missing_pricing", "unsupported_model"]);
    expect((await costs.report(orgId, period)).subtotals).toEqual([]);
    await prisma.channelConnection.update({ where: { id: channel.id }, data: { currency: null } }); channel.currency = null;
    const missing = await outbound(); await receipt(missing.providerMessageId!, "delivered", billed);
    expect((await prisma.messageCost.findFirstOrThrow({ where: { messageId: missing.id } })).state).toBe("missing_currency");
  });
  it("gratuidade depende do pricing explícito e exclui eco do celular/importação", async () => {
    const free = await outbound(); await receipt(free.providerMessageId!, "read", { ...billed, billable: false, type: "free_customer_service", category: "service" });
    for (const origin of ["business_app", "history"] as const) { const message = await outbound(origin); await receipt(message.providerMessageId!, "read", billed); }
    const report = await costs.report(orgId, period);
    expect(report.items).toHaveLength(1); expect(report.items[0]).toMatchObject({ amount: "0", state: "provider_free" });
    expect(report.counts).toMatchObject({ official: 1, businessApp: 1, history: 1 });
  });
  it("nova tarifa não muda histórico até reapuração explícita; revisão fica rastreável", async () => {
    const message = await outbound(); await receipt(message.providerMessageId!, "delivered", billed);
    await costs.addRate(orgId, rate, actorId);
    await receipt(message.providerMessageId!, "read", billed, at.getTime() / 1000 + 20);
    expect((await prisma.messageCost.findFirstOrThrow({ where: { messageId: message.id } })).amount).toBeNull();
    await assessPeriod(orgId, period); await assessPeriod(orgId, period);
    const saved = await prisma.messageCost.findFirstOrThrow({ where: { messageId: message.id }, include: { revisions: true } });
    expect(saved.amount?.toString()).toBe(rate.unitRate); expect(saved.revision).toBe(2); expect(saved.revisions).toHaveLength(2);
  });
  it("reclassificação muda apuração, mantém versões e ignora receipt antigo", async () => {
    await costs.addRate(orgId, rate, actorId); await costs.addRate(orgId, { ...rate, category: "UTILITY", unitRate: "0.000002" }, actorId);
    const message = await outbound(); await receipt(message.providerMessageId!, "delivered", billed);
    await prisma.channelConnection.update({ where: { id: channel.id }, data: { currency: "BRL" } }); channel.currency = "BRL";
    await receipt(message.providerMessageId!, "read", { ...billed, category: "utility" }, at.getTime() / 1000 + 30);
    await receipt(message.providerMessageId!, "sent", billed, at.getTime() / 1000 - 10);
    const saved = await prisma.messageCost.findFirstOrThrow({ where: { messageId: message.id } });
    expect(saved.amount?.toString()).toBe("0.000002"); expect(saved.revision).toBe(2); expect(saved.currency).toBe("USD");
  });
  it("simula faixas progressivas e vigência com Decimal; lacuna não vira zero", async () => {
    await costs.addRate(orgId, { ...rate, volumeUntil: 100 }, actorId);
    await costs.addRate(orgId, { ...rate, volumeFrom: 100, unitRate: "0.0000005" }, actorId);
    const simulation = await costs.simulate(orgId, { connectionId: channel.id, at: at.toISOString(), rows: [{ country: "BR", category: "MARKETING", pricingType: "REGULAR", quantity: 20, volumeBefore: 90 }] });
    expect(simulation.total).toBe("0.000017345"); expect(simulation.rows[0]!.segments.map(segment => segment.quantity)).toEqual([10, 10]);
    expect((await costs.simulate(orgId, { connectionId: channel.id, at: "2026-11-01T00:00:00.000Z", rows: [{ country: "BR", category: "MARKETING", pricingType: "REGULAR", quantity: 20, volumeBefore: 0 }] })).total).toBeNull();
    await expect(costs.addRate(orgId, rate, actorId)).rejects.toMatchObject({ code: "COST_RATE_OVERLAP" });
    expect(graph).not.toHaveBeenCalled();
  });
  it("analytics revisados substituem o agregado sem somar duplicatas; falta de COST é desconhecida", async () => {
    const start = Date.parse(period.start) / 1000; const end = start + 86400;
    const point = { start, end, country: "BR", pricing_category: "MARKETING", pricing_type: "REGULAR", tier: "0:MAX", volume: 2, cost: "0.123456789" };
    graph.mockResolvedValue({ currency: "USD", pricing_analytics: { data: [{ data_points: [point, point] }] } });
    await syncAnalytics(orgId, period); await syncAnalytics(orgId, period);
    let report = await costs.report(orgId, period); expect(report.analytics).toMatchObject({ total: "0.123456789", revision: 1, volume: 2, scope: "waba" });
    graph.mockResolvedValue({ currency: "USD", pricing_analytics: { data: [{ data_points: [{ ...point, cost: "0.2" }] }] } });
    await syncAnalytics(orgId, period); report = await costs.report(orgId, period); expect(report.analytics).toMatchObject({ total: "0.2", revision: 2 });
    graph.mockRejectedValue(new Error("provider private error")); await syncAnalytics(orgId, period);
    expect((await costs.report(orgId, period)).analytics).toMatchObject({ total: "0.2", status: "unavailable", revision: 2 });
    graph.mockResolvedValue({ currency: "USD", pricing_analytics: { data: [{ data_points: [{ start, end, volume: 2 }] }] } });
    await syncAnalytics(orgId, period); expect((await costs.report(orgId, period)).analytics).toMatchObject({ total: null, status: "no_cost", revision: 3 });
    const call = graph.mock.calls[0]!; expect(call[0]).toBe(channel.wabaId); expect(call[2]?.fields).toContain("metric_types(COST,VOLUME)");
  });
  it("report não retorna conteúdo privado de mensagens, request ou credencial", async () => {
    const message = await outbound(); await receipt(message.providerMessageId!, "delivered", billed);
    const response = await app.inject({ method: "GET", url: `/v1/whatsapp/costs?${new URLSearchParams(period)}`, headers: headers() });
    expect(response.statusCode).toBe(200); expect(response.body).not.toContain("Conteúdo fictício privado"); expect(response.body).not.toContain("tokenEnc");
  });
  it("preview resolve categoria e identidade no servidor, sem conceder gratuidade pela janela", async () => {
    const contactId = (await prisma.conversation.findFirstOrThrow({ where: { id: conversationId, organizationId: orgId } })).messagingContactId!;
    const identity = await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, contactId, kind: { in: ["phone", "wa_id"] } } });
    await costs.addRate(orgId, { ...rate, category: "SERVICE" }, actorId);
    const preview = await costs.preview(orgId, { connectionId: channel.id, identityId: identity.id, type: "text" });
    expect(preview).toMatchObject({ amount: rate.unitRate, state: "estimated_base", category: "SERVICE" });
    await expect(costs.preview(foreignOrg, { connectionId: channel.id, identityId: identity.id, type: "text" })).rejects.toMatchObject({ statusCode: 404 });
    const response = await app.inject({ method: "POST", url: "/v1/whatsapp/costs/preview", headers: headers(), payload: { connectionId: channel.id, identityId: identity.id, type: "text", category: "UTILITY", amount: 0 } });
    expect(response.statusCode).toBe(422); expect(graph).not.toHaveBeenCalled();
  });
  it("snapshot conserva moeda/valor em falha e recusa analytics parciais ou contraditórios", async () => {
    const start = Date.parse(period.start) / 1000;
    const point = { start, end: start + 86400, country: "BR", pricing_category: "MARKETING", volume: 1, cost: "0.01" };
    graph.mockResolvedValue({ currency: "USD", pricing_analytics: { data: [{ data_points: [point] }] } });
    await syncAnalytics(orgId, period);
    await prisma.channelConnection.update({ where: { id: channel.id }, data: { currency: "BRL" } });
    graph.mockResolvedValue({ currency: "BRL", pricing_analytics: { data: [{ data_points: [point] }], paging: { next: "https://invalid.eloscrm.test" } } });
    await syncAnalytics(orgId, period);
    expect((await costs.report(orgId, period)).analytics).toMatchObject({ total: "0.01", currency: "USD", status: "unavailable", revision: 1 });
    graph.mockResolvedValue({ currency: "USD", pricing_analytics: { data: [{ data_points: [point, { ...point, cost: "0.02" }] }] } });
    await syncAnalytics(orgId, period);
    expect((await costs.report(orgId, period)).analytics).toMatchObject({ total: "0.01", status: "unavailable", revision: 1 });
  });
  it("preserva todos os dígitos no maior produto permitido e tarifas menores que um centavo", async () => {
    await costs.addRate(orgId, { ...rate, unitRate: "99999999.1234567891" }, actorId);
    const simulation = await costs.simulate(orgId, { connectionId: channel.id, at: at.toISOString(), rows: [{ country: "BR", category: "MARKETING", pricingType: "REGULAR", quantity: 999999, volumeBefore: 0 }] });
    expect(simulation.total).toBe("99999899123457.6656432109");
    const tiny = await costs.addRate(orgId, { ...rate, category: "UTILITY", unitRate: "0.0000000001" }, actorId);
    expect(tiny.unitRate).toBe("0.0000000001");
  });
});
