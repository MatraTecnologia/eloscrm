import { randomUUID, randomInt } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
vi.mock("../src/lib/whatsapp-official/graph.js", async original => ({ ...await original<object>(), sendMessage: vi.fn(), readTemplates: vi.fn() }));
vi.mock("../src/lib/queue.js", async original => ({ ...await original<object>(), queueEnabled: vi.fn(() => true), enqueue: vi.fn(), createWorker: vi.fn() }));
vi.mock("../src/modules/whatsapp/conversations.service.js", async original => ({ ...await original<object>(), sendText: vi.fn() }));
import { sendText } from "../src/modules/whatsapp/conversations.service.js";
import * as graph from "../src/lib/whatsapp-official/graph.js";
import { queueEnabled } from "../src/lib/queue.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import * as service from "../src/modules/whatsapp-campaigns/campaigns.service.js";
import { preview } from "../src/modules/whatsapp-campaigns/preview.service.js";
import { processCampaign } from "../src/modules/whatsapp-campaigns/dispatch.service.js";
import * as permissions from "../src/modules/communication-permissions/permissions.repo.js";
import * as sends from "../src/modules/whatsapp-outbound/outbound.service.js";
import * as outbound from "../src/modules/whatsapp-outbound/outbound.repo.js";
import { ingestReceipt } from "../src/modules/whatsapp-official/receipts.repo.js";
import { processRecipient as processLegacyRecipient } from "../src/modules/broadcasts/broadcasts.service.js";
import * as legacy from "../src/modules/broadcasts/broadcasts.service.js";
import { campaignInputSchema } from "../src/modules/whatsapp-campaigns/campaigns.schema.js";
import type { CampaignInput } from "../src/modules/whatsapp-campaigns/campaigns.schema.js";
import type { ChannelConnection } from "../src/generated/prisma/client.js";
import type { TemplateDefinition } from "../src/modules/whatsapp-outbound/outbound.schema.js";

let app: FastifyInstance; let orgId: string; let cookie: string; let foreignCookie: string; let actorId: string;
let channel: ChannelConnection; let input: CampaignInput; let definition: TemplateDefinition; let clientId: string; let secondDealId: string;
let clientPhoneKey: string;
const actor = () => ({ id: actorId, name: "Gestor fictício" });
beforeAll(async () => {
  app = await makeApp(); const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `campaign-${suffix}@eloscrm.test`, `campaign-${suffix}`));
  ({ cookie: foreignCookie } = await signUpWithOrg(app, `campaign-other-${suffix}@eloscrm.test`, `campaign-other-${suffix}`));
  actorId = (await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie } })).json().user.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  vi.mocked(sendText).mockReset(); vi.mocked(sendText).mockResolvedValue({ id: "message-fixture" } as Awaited<ReturnType<typeof sendText>>);
  vi.mocked(queueEnabled).mockReturnValue(true); vi.mocked(graph.sendMessage).mockReset(); vi.mocked(graph.readTemplates).mockReset();
  const fixture = await createOfficialConnectionFixture(orgId); channel = (await outbound.connection(orgId, fixture.connection.id))!;
  const pipeline = await prisma.pipeline.create({ data: { organizationId: orgId, name: `Funil fictício ${randomUUID()}`, stages: { create: { organizationId: orgId, name: "Entrada", position: 0 } } }, include: { stages: true } });
  const phone = `5543${randomInt(100000000, 999999999)}`; clientPhoneKey = phone.slice(2, 4) + phone.slice(-8);
  const client = await prisma.client.create({ data: { organizationId: orgId, name: "Pessoa fictícia", phone, phoneKey: clientPhoneKey } }); clientId = client.id;
  const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId } });
  await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: channel.id, scope: `business:${channel.businessPortfolioId}`, kind: "wa_id", value: phone, source: "provider", validFrom: new Date(Date.now() - 60000) } });
  const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId, pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id, title: "Negócio fictício" } });
  const second = await prisma.deal.create({ data: { organizationId: orgId, clientId, pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id, title: "Outro negócio fictício" } }); secondDealId = second.id;
  definition = { id: String(Math.floor(Math.random() * 1e9)), name: "campaign_fixture", status: "APPROVED", category: "MARKETING", language: "pt_BR", components: [{ type: "BODY", text: "Informação fictícia {{1}}" }] };
  vi.mocked(graph.readTemplates).mockResolvedValue([definition]); await sends.syncTemplates(orgId, channel.id);
  const template = await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId, wabaId: channel.wabaId! } });
  input = { connectionId: channel.id, pipelineId: pipeline.id, filters: {}, dealIds: [deal.id], templateId: template.id, parameters: { header: {}, body: { "1": "Exemplo" } } };
  await prisma.officialRate.create({ data: { organizationId: orgId, wabaId: channel.wabaId!, country: "BR", category: "MARKETING", pricingType: "REGULAR", currency: channel.currency!, unitRate: "0.0000012345", volumeFrom: 0, validFrom: new Date("2026-01-01"), validUntil: new Date("2027-01-01"), sourceUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing", createdById: actorId } });
  vi.mocked(graph.sendMessage).mockResolvedValue({ messages: [{ id: `wamid.${randomUUID()}` }] });
});
const draft = async () => { const snapshot = await preview(orgId, input); return service.create(orgId, { ...input, name: "Campanha fictícia", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor()); };
const start = async () => { const saved = await draft(); const snapshot = saved.snapshot as { previewHash: string }; await service.approve(orgId, saved.id, snapshot.previewHash, true, actor()); return saved.id; };
const releaseSlot = (id: string) => prisma.officialCampaign.update({ where: { id }, data: { nextAt: new Date(Date.now() - 1000) } });

describe("campanhas oficiais sem envio real", () => {
  it("pausa sem enviar e retoma uma única vez; encerramento bloqueia retomada", async () => {
    const id = await start();
    await service.changeState(orgId, id, "paused", actor());
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).not.toHaveBeenCalled();
    expect((await service.get(orgId, id)).recipients[0]!.status).toBe("pending");
    await service.changeState(orgId, id, "running", actor());
    await processCampaign({ orgId, campaignId: id });
    await releaseSlot(id); await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    expect((await service.get(orgId, id)).status).toBe("done");
    await expect(service.changeState(orgId, id, "running", actor())).rejects.toMatchObject({ code: "CAMPAIGN_STATE" });
    const canceled = await start(); await service.cancel(orgId, canceled, actor());
    await expect(service.changeState(orgId, canceled, "running", actor())).rejects.toMatchObject({ code: "CAMPAIGN_STATE" });
  });
  it("falha em um destino não interrompe o seguinte e preserva o código do provedor", async () => {
    const original = await prisma.deal.findUniqueOrThrow({ where: { id: input.dealIds[0]! } });
    const phone = `5543${randomInt(100000000, 999999999)}`;
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Outra pessoa fictícia", phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } });
    const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId: client.id } });
    await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: channel.id, scope: `business:${channel.businessPortfolioId}`, kind: "wa_id", value: phone, source: "provider", validFrom: new Date(Date.now() - 60000) } });
    await permissions.save(orgId, client.id, { state: "allowed", evidence: "Permissão fictícia individual" }, actor());
    const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: input.pipelineId, stageId: original.stageId, title: "Outro negócio fictício" } });
    input = { ...input, dealIds: [...input.dealIds, deal.id] };
    const id = await start();
    vi.mocked(graph.sendMessage).mockRejectedValueOnce(new graph.OfficialGraphError(131026, false));
    await processCampaign({ orgId, campaignId: id }); await releaseSlot(id);
    await processCampaign({ orgId, campaignId: id }); await releaseSlot(id);
    await processCampaign({ orgId, campaignId: id });
    const saved = await service.get(orgId, id);
    expect(graph.sendMessage).toHaveBeenCalledTimes(2);
    expect(saved.status).toBe("done");
    expect(saved.recipients.filter(row => row.status === "sent")).toHaveLength(1);
    expect(saved.recipients.find(row => row.status === "failed")).toMatchObject({ errorCode: "131026", errorStage: "provider", attempts: 1 });
  });
  it("exibe destino e código quando a mensagem aceita falha posteriormente na entrega", async () => {
    const id = await start(); await processCampaign({ orgId, campaignId: id });
    const current = await service.get(orgId, id);
    const command = await outbound.command(orgId, current.recipients[0]!.commandId!);
    await ingestReceipt(channel, { id: command!.externalMessageId!, status: "failed", timestamp: String(Math.floor(Date.now() / 1000)), errors: [{ code: 131026, title: "Conteúdo privado ignorado" }] }, new Date());
    const saved = await service.get(orgId, id);
    expect(saved.recipients[0]).toMatchObject({ status: "sent", deliveryStatus: "failed", errorCode: "131026", errorStage: "delivery", destination: expect.stringMatching(/^55/) });
    expect(JSON.stringify(saved)).not.toContain("Conteúdo privado");
  });
  it("protege pausa contra outra organização e origem não autorizada", async () => {
    const id = await start();
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/campaigns/${id}/pause`, headers: { cookie: foreignCookie, origin: env.WEB_ORIGIN }, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/campaigns/${id}/pause`, headers: { cookie, origin: "https://example.invalid" }, payload: {} })).statusCode).toBe(403);
    expect((await service.get(orgId, id)).status).toBe("running");
  });

  it("mantém mensagens distintas para duas pessoas, incluindo cabeçalho e rodapé na prévia", async () => {
    const phone = `5543${randomInt(100000000, 999999999)}`;
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Isabela Fictícia", phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } });
    const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId: client.id } });
    await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: channel.id, scope: `business:${channel.businessPortfolioId}`, kind: "wa_id", value: phone, source: "provider", validFrom: new Date(Date.now() - 60000) } });
    const original = await prisma.deal.findUniqueOrThrow({ where: { id: input.dealIds[0]! } });
    const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: input.pipelineId, stageId: original.stageId, title: "Segundo imóvel fictício" } });
    await permissions.save(orgId, client.id, { state: "allowed", evidence: "Autorização fictícia individual" }, actor());
    definition = { ...definition, components: [{ type: "HEADER", format: "TEXT", text: "{{1}}" }, ...definition.components, { type: "FOOTER", text: "Rodapé fictício" }] };
    vi.mocked(graph.readTemplates).mockResolvedValue([definition]); await sends.syncTemplates(orgId, channel.id);
    input = { ...input, dealIds: [...input.dealIds, deal.id], parameters: { header: {}, body: {} }, parameterSources: { header: { "1": "dealTitle" }, body: { "1": "fullName" } } };
    const snapshot = await preview(orgId, input);
    expect(snapshot.eligible).toBe(2);
    expect(snapshot.rows.find(row => row.clientId === client.id)).toMatchObject({ text: "Segundo imóvel fictício\nInformação fictícia Isabela Fictícia\nRodapé fictício", parameters: { header: { "1": "Segundo imóvel fictício" }, body: { "1": "Isabela Fictícia" } } });
    const id = await start(); await processCampaign({ orgId, campaignId: id }); await releaseSlot(id); await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(2);
    const requests = JSON.stringify(vi.mocked(graph.sendMessage).mock.calls);
    expect(requests).toContain('"text":"Isabela Fictícia"'); expect(requests).toContain('"text":"Pessoa fictícia"');
  });
  it("resolve o nome por destinatário, congela os parâmetros e envia exatamente a prévia", async () => {
    input = { ...input, parameters: { header: {}, body: {} }, parameterSources: { header: {}, body: { "1": "firstName" } } };
    const snapshot = await preview(orgId, input);
    expect(snapshot.rows[0]).toMatchObject({ text: "Informação fictícia Pessoa", parameters: { header: {}, body: { "1": "Pessoa" } } });
    const id = await start();
    expect((await prisma.officialCampaignRecipient.findFirstOrThrow({ where: { campaignId: id } })).parameters).toEqual(snapshot.rows[0]!.parameters);
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(graph.sendMessage).mock.calls[0])).toContain('"text":"Pessoa"');
  });
  it("exclui campos ausentes e recusa mapeamento desconhecido ou misturado com valor fixo", async () => {
    const mapped: CampaignInput = { ...input, parameters: { header: {}, body: {} }, parameterSources: { header: {}, body: { "1": "propertyTitle" } } };
    const snapshot = await preview(orgId, mapped);
    expect(snapshot.eligible).toBe(0); expect(snapshot.rows[0]!.exclusion).toContain("Campo do CRM ausente");
    expect(campaignInputSchema.safeParse({ ...mapped, parameterSources: { header: {}, body: { "1": "organizationId" } } }).success).toBe(false);
    await expect(preview(orgId, { ...mapped, parameters: input.parameters })).rejects.toMatchObject({ code: "CAMPAIGN_PARAMETERS" });
  });
  it("mudança no campo personalizado exige nova aprovação e pausa antes do worker enviar", async () => {
    input = { ...input, parameters: { header: {}, body: {} }, parameterSources: { header: {}, body: { "1": "fullName" } } };
    const saved = await draft(); const hash = (saved.snapshot as { previewHash: string }).previewHash;
    await prisma.client.update({ where: { id: clientId }, data: { name: "Nome alterado" } });
    await expect(service.approve(orgId, saved.id, hash, true, actor())).rejects.toMatchObject({ code: "CAMPAIGN_CHANGED" });
    const id = await start();
    await prisma.client.update({ where: { id: clientId }, data: { name: "Nome alterado novamente" } });
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).not.toHaveBeenCalled(); expect((await service.get(orgId, id)).status).toBe("needs_review");
  });
  it("uazapi aceita leads sem permissão e ignora descadastro no worker", async () => {
    expect((await legacy.preview(orgId, { pipelineId: input.pipelineId, filters: {} })).find(row => row.dealId === input.dealIds[0])?.sendable).toBe(true);
    await prisma.uazapiInstance.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, remoteId: randomUUID(), name: "Instância fictícia", tokenEnc: channel.tokenEnc!, tokenHash: randomUUID(), webhookSecret: randomUUID(), status: "connected" }, update: { status: "connected" } });
    const saved = await legacy.create(orgId, { pipelineId: input.pipelineId, filters: {}, dealIds: input.dealIds, text: "Teste fictício" }, actor());
    expect(saved.recipients[0]).toMatchObject({ status: "PENDING", error: null });
    await permissions.save(orgId, clientId, { state: "suppressed", evidence: "Registro histórico desativado" }, actor());
    expect((await legacy.preview(orgId, { pipelineId: input.pipelineId, filters: {} })).find(row => row.dealId === input.dealIds[0])?.sendable).toBe(true);
    await processLegacyRecipient({ recipientId: saved.recipients[0]!.id });
    expect((await prisma.broadcastRecipient.findUniqueOrThrow({ where: { id: saved.recipients[0]!.id } })).status).toBe("SENT");
    expect(sendText).toHaveBeenCalledTimes(1);
  });
  it("endpoints de permissão estão desativados", async () => {
    const url = `/v1/whatsapp/campaigns/permissions/${clientId}`;
    expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: { cookie, origin: env.WEB_ORIGIN }, payload: { state: "allowed", evidence: "Teste" } })).statusCode).toBe(404);
    expect(await prisma.communicationPermission.count({ where: { clientId } })).toBe(0);
  });
  it("protege tenant, papel, origem e valores financeiros; idempotência de criação", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/campaigns/preview", payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/campaigns/preview", headers: { cookie, origin: "https://foreign.test" }, payload: input })).statusCode).toBe(403);
    const snapshot = await preview(orgId, input); const raw = { ...input, name: "Campanha", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash };
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/campaigns", headers: { cookie, origin: env.WEB_ORIGIN }, payload: { ...raw, total: 0 } })).statusCode).toBe(422);
    const saved = await service.create(orgId, raw, actor()); expect((await service.create(orgId, raw, actor())).id).toBe(saved.id);
    await expect(service.create(orgId, { ...raw, name: "Outro" }, actor())).rejects.toMatchObject({ statusCode: 409 });
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/campaigns/${saved.id}`, headers: { cookie: foreignCookie } })).statusCode).toBe(404);
    const member = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, userId: actorId } });
    await prisma.member.update({ where: { id: member.id }, data: { role: "member" } });
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/campaigns/${saved.id}`, headers: { cookie } })).statusCode).toBe(403);
    await prisma.member.update({ where: { id: member.id }, data: { role: "owner" } });
    expect(JSON.stringify(saved)).not.toMatch(/tokenEnc|requestHash|leaseToken/);
  });
  it("deduplica por pessoa, ignora descadastro e exclui identidade inválida", async () => {
    const result = await preview(orgId, { ...input, dealIds: [...input.dealIds, secondDealId] });
    expect(result.eligible).toBe(1); expect(result.excluded).toBe(1); expect(result.estimate.amount).toBe("0.0000012345");
    await permissions.save(orgId, clientId, { state: "suppressed", evidence: "Descadastro fictício" }, actor());
    expect((await preview(orgId, input)).eligible).toBe(1);
    expect(await prisma.communicationPermissionRevision.count({ where: { organizationId: orgId, permission: { clientId } } })).toBe(1);
    await permissions.save(orgId, clientId, { state: "allowed", evidence: "Nova permissão fictícia" }, actor());
    await prisma.contactIdentity.updateMany({ where: { organizationId: orgId, connectionId: channel.id }, data: { validUntil: new Date() } });
    expect((await preview(orgId, input)).rows[0]!.exclusion).toMatch(/identidade/);
  });
  it("não inicia sem Redis e exige novo snapshot quando tarifa muda", async () => {
    const saved = await draft(); const old = (saved.snapshot as { previewHash: string }).previewHash;
    vi.mocked(queueEnabled).mockReturnValue(false);
    await expect(service.approve(orgId, saved.id, old, true, actor())).rejects.toMatchObject({ code: "CAMPAIGN_REDIS_REQUIRED" });
    vi.mocked(sendText).mockReset(); vi.mocked(sendText).mockResolvedValue({ id: "message-fixture" } as Awaited<ReturnType<typeof sendText>>);
  vi.mocked(queueEnabled).mockReturnValue(true);
    await prisma.officialRate.updateMany({ where: { organizationId: orgId, wabaId: channel.wabaId! }, data: { unitRate: "0.000002" } });
    await expect(service.approve(orgId, saved.id, old, true, actor())).rejects.toMatchObject({ code: "CAMPAIGN_CHANGED" });
    const revised = await service.repreview(orgId, saved.id);
    await service.approve(orgId, saved.id, revised.previewHash, false, actor()); await service.approve(orgId, saved.id, revised.previewHash, true, actor());
    expect((await service.get(orgId, saved.id)).status).toBe("running"); expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("jobs repetidos geram uma submissão; aceite e entrega são separados", async () => {
    const id = await start(); await Promise.all([processCampaign({ orgId, campaignId: id }), processCampaign({ orgId, campaignId: id })]);
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    const current = await service.get(orgId, id); expect(current.recipients[0]).toMatchObject({ status: "sent", deliveryStatus: "sent", cost: null });
    const command = await outbound.command(orgId, current.recipients[0]!.commandId!);
    await ingestReceipt(channel, { id: command!.externalMessageId!, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), pricing: { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" } }, new Date());
    expect((await service.get(orgId, id)).recipients[0]).toMatchObject({ deliveryStatus: "read", cost: { amount: "0.0000012345" } });
    await releaseSlot(id); await processCampaign({ orgId, campaignId: id }); expect((await service.get(orgId, id)).status).toBe("done");
  });
  it("descadastro histórico em outro lead não impede envio oficial", async () => {
    const id = await start();
    const duplicate = await prisma.client.create({ data: { organizationId: orgId, name: "Outro cadastro", phoneKey: clientPhoneKey } });
    await permissions.save(orgId, duplicate.id, { state: "suppressed", evidence: "Descadastro fictício compartilhado" }, actor());
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1); expect((await service.get(orgId, id)).recipients[0]!.status).toBe("sent");
  });
  it("cancelamento durante consulta remota impede submissão e a recuperação não burla a fila", async () => {
    const id = await start();
    vi.mocked(graph.readTemplates).mockImplementationOnce(async () => { await service.cancel(orgId, id, actor()); return [definition]; });
    await processCampaign({ orgId, campaignId: id }); expect(graph.sendMessage).not.toHaveBeenCalled();
    expect((await service.get(orgId, id)).status).toBe("canceled");
    expect((await outbound.recover()).every(row => row.organizationId !== orgId)).toBe(true);
  });
  it("timeout e crash após aceite não reenviam; a chave permanece vinculada ao destinatário", async () => {
    const id = await start(); vi.mocked(graph.sendMessage).mockRejectedValueOnce(new Error("timeout fictício"));
    await processCampaign({ orgId, campaignId: id }); const saved = await service.get(orgId, id);
    expect(saved.recipients[0]!.status).toBe("unknown");
    await prisma.officialCampaignRecipient.updateMany({ where: { organizationId: orgId, campaignId: id }, data: { status: "preparing", leaseExpiresAt: new Date(Date.now() - 1000) } });
    await releaseSlot(id); await processCampaign({ orgId, campaignId: id }); expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    expect((await service.get(orgId, id)).recipients[0]!.status).toBe("unknown");
  });
  it("tarifa alterada antes do worker pausa; não muda estimativa aprovada nem envia", async () => {
    const id = await start(); await prisma.officialRate.updateMany({ where: { organizationId: orgId, wabaId: channel.wabaId! }, data: { unitRate: "0.3" } });
    await processCampaign({ orgId, campaignId: id }); expect(graph.sendMessage).not.toHaveBeenCalled();
    const saved = await service.get(orgId, id); expect(saved.status).toBe("needs_review"); expect((saved.snapshot as { estimate: { amount: string } }).estimate.amount).toBe("0.0000012345");
  });
  it("duas campanhas no mesmo número respeitam slot persistido e não enviam juntas", async () => {
    const first = await start(); const second = await start();
    await Promise.all([processCampaign({ orgId, campaignId: first }), processCampaign({ orgId, campaignId: second })]);
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    const remaining = (await service.get(orgId, first)).recipients[0]!.status === "pending" ? first : second;
    await releaseSlot(first); await releaseSlot(second); await processCampaign({ orgId, campaignId: remaining });
    expect(graph.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("histórico de descadastro não bloqueia o número congelado no worker uazapi", async () => {
    const saved = await prisma.broadcast.create({ data: { organizationId: orgId, pipelineId: input.pipelineId, pipelineName: "Funil fictício", text: "Mensagem fictícia", filters: {}, createdByName: actor().name, total: 1 } });
    const recipient = await prisma.broadcastRecipient.create({ data: { broadcastId: saved.id, clientId, dealId: input.dealIds[0]!, clientName: "Pessoa fictícia", number: (await permissions.client(orgId, clientId))!.phoneKey ? (await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).phone! : "", text: "Mensagem fictícia" } });
    await prisma.client.update({ where: { id: clientId }, data: { phoneKey: "4311112222" } });
    const duplicate = await prisma.client.create({ data: { organizationId: orgId, name: "Descadastro fictício", phoneKey: clientPhoneKey } });
    await permissions.save(orgId, duplicate.id, { state: "suppressed", evidence: "Descadastro fictício no número original" }, actor());
    await prisma.client.update({ where: { id: duplicate.id }, data: { phoneKey: "4333334444" } });
    await permissions.save(orgId, duplicate.id, { state: "allowed", evidence: "Autorização para o novo número" }, actor());
    await prisma.broadcast.updateMany({ where: { organizationId: orgId }, data: { nextAt: new Date(Date.now() - 1000) } });
    await processLegacyRecipient({ recipientId: recipient.id });
    expect((await prisma.broadcastRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).status).toBe("SENT");
    expect(sendText).toHaveBeenCalledTimes(1);
  });
  it("BSUID permite campanha, mas mercado ausente não vira custo zero", async () => {
    await prisma.contactIdentity.updateMany({ where: { organizationId: orgId, connectionId: channel.id }, data: { kind: "bsuid", value: "BR.fixture-user" } });
    const result = await preview(orgId, input); expect(result.eligible).toBe(1); expect(result.estimate.amount).toBeNull(); expect(result.estimate.unresolved).toBe(1);
    const id = await start(); await processCampaign({ orgId, campaignId: id });
    const payload = vi.mocked(graph.sendMessage).mock.calls[0]![2]; expect(payload.recipient).toBe("BR.fixture-user"); expect(payload.to).toBeUndefined();
  });
  it("aliases phone e wa_id de cadastros distintos não duplicam o mesmo destino oficial", async () => {
    const identity = await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, connectionId: channel.id } });
    const duplicate = await prisma.client.create({ data: { organizationId: orgId, name: "Alias fictício", phoneKey: clientPhoneKey } });
    const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId: duplicate.id } });
    await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: channel.id, scope: identity.scope, kind: "phone", value: identity.value, source: "provider" } });
    await permissions.save(orgId, duplicate.id, { state: "allowed", evidence: "Autorização fictícia para teste" }, actor());
    await prisma.deal.update({ where: { id: secondDealId }, data: { clientId: duplicate.id } });
    const result = await preview(orgId, { ...input, dealIds: [...input.dealIds, secondDealId] });
    expect(result.eligible).toBe(1); expect(result.excluded).toBe(1); expect(result.rows.find(row => row.exclusion)?.exclusion).toContain("já selecionada");
  });
  it("registro histórico durante consulta remota não bloqueia envio nem duplica o início", async () => {
    const id = await start(); const snapshot = (await service.get(orgId, id)).snapshot as { previewHash: string };
    await service.approve(orgId, id, snapshot.previewHash, true, actor());
    vi.mocked(graph.readTemplates).mockImplementationOnce(async () => { await permissions.save(orgId, clientId, { state: "suppressed", evidence: "Descadastro durante preparação" }, actor()); return [definition]; });
    await processCampaign({ orgId, campaignId: id }); expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    expect((await service.get(orgId, id)).recipients[0]!.status).toBe("sent");
  });
  it("dispara template para telefone importado sem criar lead ou card e preserva a identidade na resposta", async () => {
    const phone = "5543999990001";
    const request: CampaignInput = { ...input, dealIds: [], importedAudience: { recipients: [{ phone, name: "Pessoa importada" }] }, parameters: { header: {}, body: {} }, parameterSources: { header: {}, body: { "1": "firstName" } } };
    const counts = [await prisma.client.count({ where: { organizationId: orgId } }), await prisma.deal.count({ where: { organizationId: orgId } })];
    const snapshot = await preview(orgId, request);
    expect(snapshot.eligible).toBe(1); expect(snapshot.rows[0]?.text).toContain("Pessoa"); expect(snapshot.estimate.amount).not.toBeNull();
    const saved = await service.create(orgId, { ...request, name: "Lista importada", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor());
    const identityId = snapshot.rows[0]!.identityId!;
    await expect(sends.createSend(orgId, channel.id, { type: "template", templateId: input.templateId, identityId, idempotencyKey: randomUUID(), parameters: { header: {}, body: { "1": "Pessoa" } } }, actor())).rejects.toMatchObject({ code: "OFFICIAL_RECIPIENT_INVALID" });
    await service.approve(orgId, saved.id, snapshot.previewHash, true, actor());
    await processCampaign({ orgId, campaignId: saved.id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1); expect(vi.mocked(graph.sendMessage).mock.calls[0]![2].to).toBe(phone);
    expect((await service.get(orgId, saved.id)).recipients[0]?.status).toBe("sent");
    expect([await prisma.client.count({ where: { organizationId: orgId } }), await prisma.deal.count({ where: { organizationId: orgId } })]).toEqual(counts);
    const imported = await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, id: identityId } });
    expect(imported.source).toBe("campaign_import");
    const { withConnectionLock, resolveAliases } = await import("../src/modules/whatsapp-official/identity.repo.js");
    const received = await withConnectionLock(channel, tx => resolveAliases(tx, channel, [{ kind: "wa_id", value: phone }], "Nome confirmado"));
    expect(received.id).toBe(imported.contactId);
    expect((await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, id: identityId } })).source).toBe("campaign_import");
  });
  it("telefone importado com descadastro histórico continua elegível para envio", async () => {
    const request: CampaignInput = { ...input, dealIds: [], importedAudience: { recipients: [{ phone: "5543999990002", name: "Pessoa importada" }] } };
    const snapshot = await preview(orgId, request);
    const saved = await service.create(orgId, { ...request, name: "Lista importada", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor());
    await service.approve(orgId, saved.id, snapshot.previewHash, true, actor());
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Pessoa descadastrada", phone: "5543999990002", phoneKey: "4399990002" } });
    await permissions.save(orgId, client.id, { state: "suppressed", evidence: "Descadastro fictício posterior" }, actor());
    await processCampaign({ orgId, campaignId: saved.id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1); expect((await service.get(orgId, saved.id)).recipients[0]?.status).toBe("sent");
  });

});
