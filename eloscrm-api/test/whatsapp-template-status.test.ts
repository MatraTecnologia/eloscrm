import { createHmac, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { env } from "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import * as graph from "../src/lib/whatsapp-official/graph.js";
import { processEvent } from "../src/modules/whatsapp-official/webhook.service.js";
import { saveTemplates } from "../src/modules/whatsapp-outbound/outbound.repo.js";
import { save } from "../src/modules/whatsapp-templates/templates.repo.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";

vi.mock("../src/lib/whatsapp-official/graph.js", async importOriginal => ({ ...await importOriginal<typeof graph>(), readTemplates: vi.fn() }));
let app: FastifyInstance;
let orgId: string;
let otherOrgId: string;
let cookie: string;
let otherCookie: string;
let connectionId: string;
let wabaId: string;
let externalId: string;
let templateId: string;
const eventTime = Math.floor(Date.now() / 1000);
const definition = () => ({ id: externalId, name: "confirmacao_visita", language: "pt_BR", category: "UTILITY", status: "PENDING", components: [{ type: "BODY", text: "Sua visita está confirmada." }] });
const read = () => prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId, id: templateId } });
const payload = (event: string, extra: Record<string, unknown> = {}, accountId = wabaId, time = eventTime) => ({ object: "whatsapp_business_account", entry: [{ id: accountId, time, changes: [{ field: "message_template_status_update", value: { event, message_template_id: Number(externalId), message_template_name: "confirmacao_visita", message_template_language: "pt-BR", reason: "NONE", ...extra } }] }] });
const deliver = async (body: ReturnType<typeof payload>) => {
  const raw = JSON.stringify(body);
  const response = await app.inject({ method: "POST", url: "/webhooks/whatsapp-official", payload: raw, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", env.META_WHATSAPP_APP_SECRET!).update(raw).digest("hex")}` } });
  expect(response.statusCode).toBe(200);
  const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { wabaId: body.entry[0]!.id, field: "message_template_status_update", payload: { equals: body.entry[0]!.changes[0]!.value as never } }, orderBy: { receivedAt: "desc" } });
  await processEvent(event.id);
  return prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
};

beforeAll(async () => {
  app = await makeApp();
  ({ orgId, cookie } = await signUpWithOrg(app, `template-status-${randomUUID()}@eloscrm.test`, `template-status-${randomUUID()}`));
  ({ orgId: otherOrgId, cookie: otherCookie } = await signUpWithOrg(app, `template-other-${randomUUID()}@eloscrm.test`, `template-other-${randomUUID()}`));
  const fixture = await createOfficialConnectionFixture(orgId);
  connectionId = fixture.connection.id;
  wabaId = fixture.input.wabaId;
  await createOfficialConnectionFixture(orgId, { wabaId, businessPortfolioId: fixture.input.businessPortfolioId });
});
beforeEach(async () => {
  vi.clearAllMocks();
  externalId = String(randomInt(1, 1_000_000_000));
  templateId = (await prisma.officialTemplate.create({ data: { organizationId: orgId, wabaId, externalId, name: "confirmacao_visita", language: "pt_BR", category: "UTILITY", status: "PENDING", definition: definition() } })).id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe("status de templates por webhook", () => {
  it("aprova por WABA sem phone_number_id mesmo com dois números e deduplica a reentrega", async () => {
    const body = payload("APPROVED", { message_template_category: "MARKETING" });
    expect((await deliver(body)).status).toBe("processed");
    expect((await read()).status).toBe("APPROVED");
    expect((await read()).category).toBe("MARKETING");
    const count = await prisma.officialWebhookEvent.count({ where: { wabaId, payload: { equals: body.entry[0]!.changes[0]!.value as never } } });
    await deliver(body);
    expect(await prisma.officialWebhookEvent.count({ where: { wabaId, payload: { equals: body.entry[0]!.changes[0]!.value as never } } })).toBe(count);
    expect(graph.readTemplates).not.toHaveBeenCalled();
  });
  it("mostra motivo, detalhe e recomendação somente para a imobiliária autorizada", async () => {
    await deliver(payload("REJECTED", { reason: "INVALID_FORMAT", rejection_info: { reason: "Parâmetros sem contexto.", recommendation: "Inclua texto entre os parâmetros." } }));
    const response = await app.inject({ method: "GET", url: `/v1/whatsapp/outbound/connections/${connectionId}/templates`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().find((item: { id: string }) => item.id === templateId)).toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_FORMAT", rejectionDetail: "Parâmetros sem contexto.", rejectionRecommendation: "Inclua texto entre os parâmetros." });
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/outbound/connections/${connectionId}/templates`, headers: { cookie: otherCookie } })).statusCode).toBe(404);
  });
  it("limpa a rejeição ao aprovar e ignora uma rejeição antiga entregue depois", async () => {
    await deliver(payload("REJECTED", { reason: "INVALID_FORMAT" }, wabaId, eventTime - 10));
    await deliver(payload("APPROVED", {}, wabaId, eventTime));
    await deliver(payload("REJECTED", { reason: "SCAM" }, wabaId, eventTime - 5));
    expect(await read()).toMatchObject({ status: "APPROVED", rejectionReason: null, rejectionDetail: null, rejectionRecommendation: null });
  });
  it("não altera outro tenant nem outra WABA com o mesmo ID externo", async () => {
    const other = await prisma.officialTemplate.create({ data: { organizationId: otherOrgId, wabaId, externalId, name: "confirmacao_visita", language: "pt_BR", category: "UTILITY", status: "PENDING", definition: definition() } });
    const different = await prisma.officialTemplate.create({ data: { organizationId: orgId, wabaId: "987654321123", externalId, name: "confirmacao_visita", language: "pt_BR", category: "UTILITY", status: "PENDING", definition: definition() } });
    await deliver(payload("APPROVED"));
    expect((await prisma.officialTemplate.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("PENDING");
    expect((await prisma.officialTemplate.findUniqueOrThrow({ where: { id: different.id } })).status).toBe("PENDING");
  });
  it("recusa assinatura inválida antes de guardar o evento", async () => {
    const response = await app.inject({ method: "POST", url: "/webhooks/whatsapp-official", payload: JSON.stringify(payload("APPROVED")), headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=invalid" } });
    expect(response.statusCode).toBe(403);
    expect((await read()).status).toBe("PENDING");
  });
  it("preserva o webhook mais recente quando uma sincronização antiga termina depois", async () => {
    const startedAt = new Date(Date.now() - 60_000);
    await deliver(payload("REJECTED", { reason: "INVALID_FORMAT" }));
    await saveTemplates(orgId, wabaId, [{ ...definition(), status: "APPROVED" }], startedAt);
    expect(await read()).toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_FORMAT" });
  });
  it("mantém a explicação detalhada após sincronizar a mesma rejeição", async () => {
    await deliver(payload("REJECTED", { reason: "INVALID_FORMAT", rejection_info: { reason: "Parâmetros sem contexto." } }));
    await saveTemplates(orgId, wabaId, [{ ...definition(), status: "REJECTED", rejected_reason: "INVALID_FORMAT" }]);
    expect((await read()).rejectionDetail).toBe("Parâmetros sem contexto.");
  });
  it("sincroniza automaticamente um template ainda ausente no CRM", async () => {
    await prisma.officialTemplate.deleteMany({ where: { organizationId: orgId, id: templateId } });
    vi.mocked(graph.readTemplates).mockResolvedValue([{ ...definition(), status: "APPROVED" }]);
    expect((await deliver(payload("APPROVED"))).status).toBe("processed");
    expect((await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId, wabaId, externalId } })).status).toBe("APPROVED");
    expect(graph.readTemplates).toHaveBeenCalledTimes(1);
  });
  it.each([["PAUSED", "PAUSED"], ["DISABLED", "DISABLED"], ["PENDING_DELETION", "PENDING_DELETION"], ["DELETED", "MISSING"], ["REINSTATED", "APPROVED"]])("processa a transição %s", async (event, status) => {
    expect((await deliver(payload(event!))).status).toBe("processed");
    expect((await read()).status).toBe(status);
  });
  it("mantém conta desconhecida sem resolução e não modifica os templates locais", async () => {
    expect((await deliver(payload("APPROVED", {}, "987654321987654"))).status).toBe("unresolved");
    expect((await read()).status).toBe("PENDING");
  });
  it("não perde uma aprovação recebida antes de salvar a resposta da criação", async () => {
    await deliver(payload("APPROVED", { message_template_category: "MARKETING" }));
    await save(orgId, wabaId, definition());
    expect(await read()).toMatchObject({ status: "APPROVED", category: "MARKETING", definition: expect.objectContaining({ status: "APPROVED", category: "MARKETING" }) });
  });
});
