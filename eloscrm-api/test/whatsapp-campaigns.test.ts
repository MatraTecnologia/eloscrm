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
import { formatBrPhone, officialPhoneVariants } from "../src/lib/phone.js";
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
  const phone = `55439${randomInt(10000000, 99999999)}`; clientPhoneKey = phone.slice(2, 4) + phone.slice(-8);
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
    // Encerrada antes de qualquer envio: depois dele, a mesma pessoa nem seria elegível de novo.
    const canceled = await start(); await service.cancel(orgId, canceled, actor());
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
  it("mudança no campo personalizado exige nova aprovação e, no meio do disparo, pula só esse lead", async () => {
    input = { ...input, parameters: { header: {}, body: {} }, parameterSources: { header: {}, body: { "1": "fullName" } } };
    const saved = await draft(); const hash = (saved.snapshot as { previewHash: string }).previewHash;
    await prisma.client.update({ where: { id: clientId }, data: { name: "Nome alterado" } });
    await expect(service.approve(orgId, saved.id, hash, true, actor())).rejects.toMatchObject({ code: "CAMPAIGN_CHANGED" });
    const id = await start();
    await prisma.client.update({ where: { id: clientId }, data: { name: "Nome alterado novamente" } });
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).not.toHaveBeenCalled();
    const current = await service.get(orgId, id);
    expect(current.status).toBe("running"); expect(current.recipients[0]).toMatchObject({ status: "skipped", errorCode: "CAMPAIGN_RECIPIENT_CHANGED" });
    expect(current.recipients[0]!.safeError).toContain("dados personalizados");
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
    expect((await preview(orgId, input)).rows[0]!.exclusion).toMatch(/identidade/i);
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
    const first = await start();
    // Pessoas diferentes: a mesma pessoa não recebe o mesmo template de duas campanhas.
    const phone = `55439${randomInt(10000000, 99999999)}`;
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Outra pessoa", phone } });
    const original = await prisma.deal.findUniqueOrThrow({ where: { id: input.dealIds[0]! } });
    const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: input.pipelineId, stageId: original.stageId, title: "Outro negócio" } });
    input = { ...input, dealIds: [deal.id] };
    vi.mocked(graph.sendMessage).mockImplementation(async () => ({ messages: [{ id: `wamid.${randomUUID()}` }] }));
    const second = await start();
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
  describe("lead do CRM que nunca conversou pelo número oficial", () => {
    const crmDeal = async (name: string, phone: string | null) => {
      const original = await prisma.deal.findUniqueOrThrow({ where: { id: input.dealIds[0]! } });
      const client = await prisma.client.create({ data: { organizationId: orgId, name, phone } });
      const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: input.pipelineId, stageId: original.stageId, title: `Negócio de ${name}` } });
      return { client, deal };
    };
    const subscriber = () => String(randomInt(10000000, 99999999)).replace(/^./, "8");

    it("recebe o template pelo telefone do cadastro, com o nono dígito, e a resposta cai no mesmo contato", async () => {
      const digits = subscriber();
      const { client, deal } = await crmDeal("Lead sem conversa", `(43) ${digits.slice(0, 4)}-${digits.slice(4)}`);
      input = { ...input, dealIds: [deal.id] };
      const snapshot = await preview(orgId, input);
      expect(snapshot.eligible).toBe(1); expect(snapshot.estimate.amount).toBe("0.0000012345");
      const identity = await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, id: snapshot.rows[0]!.identityId! }, include: { contact: true } });
      expect(identity).toMatchObject({ source: "campaign_import", kind: "phone", value: `55439${digits}` });
      expect(identity.contact.clientId).toBeNull();
      expect(client.id).toBeTruthy();
      const id = await start(); await processCampaign({ orgId, campaignId: id });
      expect(graph.sendMessage).toHaveBeenCalledTimes(1); expect(vi.mocked(graph.sendMessage).mock.calls[0]![2].to).toBe(`55439${digits}`);
      expect((await service.get(orgId, id)).recipients[0]?.status).toBe("sent");
      const { withConnectionLock, resolveAliases } = await import("../src/modules/whatsapp-official/identity.repo.js");
      const received = await withConnectionLock(channel, tx => resolveAliases(tx, channel, [{ kind: "wa_id", value: `5543${digits}` }], "Lead respondeu"));
      expect(received.id).toBe(identity.contactId);
    });
    it("reaproveita o contato técnico que o lead já tem e mantém o identificador estável entre prévias", async () => {
      const digits = subscriber();
      const { client, deal } = await crmDeal("Lead com contato", `5543 9${digits}`);
      const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId: client.id } });
      const first = await preview(orgId, { ...input, dealIds: [deal.id] });
      const second = await preview(orgId, { ...input, dealIds: [deal.id] });
      expect(first.rows[0]).toMatchObject({ contactId: contact.id, exclusion: null });
      expect(second.rows[0]!.identityId).toBe(first.rows[0]!.identityId); expect(second.previewHash).toBe(first.previewHash);
    });
    it("exclui telefone inválido e deduplica o mesmo celular gravado com e sem o nono dígito", async () => {
      const digits = subscriber();
      const without = await crmDeal("Sem telefone", null);
      const old = await crmDeal("Formato antigo", `43${digits}`);
      const current = await crmDeal("Formato atual", `+55 43 9${digits}`);
      const result = await preview(orgId, { ...input, dealIds: [without.deal.id, old.deal.id, current.deal.id] });
      expect(result.eligible).toBe(1);
      expect(result.rows.find(row => row.dealId === without.deal.id)?.exclusion).toBe("Lead sem celular válido no cadastro");
      expect(result.rows.filter(row => row.exclusion?.includes("já selecionada"))).toHaveLength(1);
    });
    it("exclui telefone fixo e não confunde celular 9[1-5] com o fixo de mesmos dígitos", async () => {
      const landline = await crmDeal("Lead com fixo", "(11) 4324-1234");
      expect((await preview(orgId, { ...input, dealIds: [landline.deal.id] })).rows[0]!.exclusion).toBe("Lead sem celular válido no cadastro");
      expect(officialPhoneVariants("5511943241234")).toEqual(["5511943241234"]);
      const imported = await preview(orgId, { ...input, dealIds: [], importedAudience: { recipients: [{ phone: "551143241234", name: "Fixo importado" }] } });
      const mobile = await crmDeal("Lead com celular 94", "(11) 94324-1234");
      const result = await preview(orgId, { ...input, dealIds: [mobile.deal.id] });
      expect(result.rows[0]).toMatchObject({ exclusion: null }); expect(result.rows[0]!.contactId).not.toBe(imported.rows[0]!.contactId);
    });
    it("lista importada com as duas grafias do mesmo celular vira um destinatário e a campanha é criada", async () => {
      const digits = subscriber();
      const request: CampaignInput = { ...input, dealIds: [], importedAudience: { recipients: [{ phone: `5543${digits}`, name: "Grafia antiga" }, { phone: `55439${digits}`, name: "Grafia atual" }] } };
      const snapshot = await preview(orgId, request);
      expect(snapshot.eligible).toBe(1); expect(snapshot.rows.find(row => row.exclusion)?.exclusion).toBe("Telefone repetido nesta lista");
      const saved = await service.create(orgId, { ...request, name: "Lista com grafias", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor());
      expect((await service.get(orgId, saved.id)).recipients).toHaveLength(1);
    });
    it("lead que escreve no meio do disparo não pausa a campanha", async () => {
      const digits = subscriber();
      const { deal } = await crmDeal("Lead que respondeu antes", `(43) 9${digits.slice(0, 4)}-${digits.slice(4)}`);
      input = { ...input, dealIds: [deal.id] };
      const id = await start();
      const { withConnectionLock, resolveAliases } = await import("../src/modules/whatsapp-official/identity.repo.js");
      await withConnectionLock(channel, tx => resolveAliases(tx, channel, [{ kind: "wa_id", value: `5543${digits}` }], "Lead escreveu", new Date()));
      await processCampaign({ orgId, campaignId: id });
      const saved = await service.get(orgId, id);
      expect(saved.status).not.toBe("needs_review"); expect(saved.recipients[0]?.status).toBe("sent");
      expect(vi.mocked(graph.sendMessage).mock.calls[0]![2].to).toBe(`55439${digits}`);
    });
    it("envio entra na ficha do lead e a resposta pelo webhook real cai na mesma conversa, sem lead nem card novo", async () => {
      const digits = subscriber();
      const { client, deal } = await crmDeal("Lead da prospecção", `(43) 9${digits.slice(0, 4)}-${digits.slice(4)}`);
      await prisma.client.update({ where: { id: client.id }, data: { phoneKey: `43${digits}` } });
      const original = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
      await prisma.leadAutomation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, autoCreateClient: true, autoCreateDeal: true, pipelineId: original.pipelineId, stageId: original.stageId }, update: { autoCreateClient: true, autoCreateDeal: true, pipelineId: original.pipelineId, stageId: original.stageId } });
      input = { ...input, dealIds: [deal.id] };
      const id = await start(); await processCampaign({ orgId, campaignId: id });
      const sent = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId, officialCommand: { campaignRecipientId: { not: null } }, conversation: { clientId: client.id } }, include: { conversation: true } });
      const counts = [await prisma.client.count({ where: { organizationId: orgId } }), await prisma.deal.count({ where: { organizationId: orgId } })];
      const { capture } = await import("../src/modules/whatsapp-official/webhook.repo.js");
      const { processEvent } = await import("../src/modules/whatsapp-official/webhook.service.js");
      const { process: runAutomation } = await import("../src/modules/lead-automation/inbound-automation.repo.js");
      const sender = randomUUID(); const replyId = `wamid.${randomUUID()}`;
      const value = { messaging_product: "whatsapp", metadata: { phone_number_id: channel.phoneNumberId }, contacts: [{ user_id: sender, wa_id: `5543${digits}`, profile: { name: "Lead da prospecção" } }], messages: [{ id: replyId, from_user_id: sender, from: `5543${digits}`, type: "text", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "Tenho interesse" } }] };
      await capture({ object: "whatsapp_business_account", entry: [{ id: channel.wabaId, changes: [{ field: "messages", value }] }] }, new Date());
      const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { organizationId: orgId, field: "messages", payload: { equals: value as never } } });
      await processEvent(event.id);
      const reply = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgId, providerMessageId: replyId } });
      await runAutomation(orgId, reply.id);
      expect(reply.conversationId).toBe(sent.conversationId);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: sent.conversationId } })).clientId).toBe(client.id);
      expect([await prisma.client.count({ where: { organizationId: orgId } }), await prisma.deal.count({ where: { organizationId: orgId } })]).toEqual(counts);
      await prisma.leadAutomation.deleteMany({ where: { organizationId: orgId } });
    });
    it("usa a identidade do provedor gravada sem o nono dígito em vez de criar outra", async () => {
      const digits = subscriber();
      const { deal } = await crmDeal("Lead com wa_id antigo", `(43) 9${digits.slice(0, 4)}-${digits.slice(4)}`);
      const orphan = await prisma.messagingContact.create({ data: { organizationId: orgId } });
      const provider = await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: orphan.id, connectionId: channel.id, scope: `business:${channel.businessPortfolioId}`, kind: "wa_id", value: `5543${digits}`, source: "provider", validFrom: new Date(Date.now() - 60000) } });
      const result = await preview(orgId, { ...input, dealIds: [deal.id] });
      expect(result.rows[0]).toMatchObject({ identityId: provider.id, exclusion: null });
    });
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

describe("disparo resiliente", () => {
  const extraRecipient = async (name: string) => {
    const phone = `55439${randomInt(10000000, 99999999)}`;
    const client = await prisma.client.create({ data: { organizationId: orgId, name, phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } });
    const original = await prisma.deal.findUniqueOrThrow({ where: { id: input.dealIds[0]! } });
    const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: input.pipelineId, stageId: original.stageId, title: `Negócio de ${name}` } });
    input = { ...input, dealIds: [...input.dealIds, deal.id] };
    return { client, deal };
  };
  beforeEach(() => { vi.mocked(graph.sendMessage).mockImplementation(async () => ({ messages: [{ id: `wamid.${randomUUID()}` }] })); });
  const drain = async (id: string, times: number) => { for (let i = 0; i < times; i++) { await processCampaign({ orgId, campaignId: id }); await releaseSlot(id); } };

  it("lead que sai dos filtros no meio do disparo é pulado e os outros recebem", async () => {
    const { deal } = await extraRecipient("Segundo lead");
    const id = await start();
    const other = await prisma.stage.create({ data: { organizationId: orgId, pipelineId: input.pipelineId, name: "Outro estágio", position: 1 } });
    await prisma.officialCampaign.update({ where: { id }, data: { input: { ...input, filters: { stageIds: [(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId] } } } });
    await prisma.deal.update({ where: { id: deal.id }, data: { stageId: other.id } });
    await drain(id, 3);
    const saved = await service.get(orgId, id);
    expect(saved.status).toBe("done");
    expect(saved.recipients.find(row => row.dealId === deal.id)).toMatchObject({ status: "skipped", errorCode: "CAMPAIGN_RECIPIENT_CHANGED" });
    expect(saved.recipients.filter(row => row.status === "sent")).toHaveLength(1);
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("erro da conta na Meta pausa a campanha, devolve o lead à fila e retomar envia sem duplicar", async () => {
    await extraRecipient("Segundo lead");
    const id = await start();
    vi.mocked(graph.sendMessage).mockRejectedValueOnce(new graph.OfficialGraphError(131042, false));
    await drain(id, 2);
    let saved = await service.get(orgId, id);
    expect(saved.status).toBe("paused"); expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    expect(saved.recipients.every(row => row.status === "pending")).toBe(true);
    expect(saved.recipients.find(row => row.safeError)?.safeError).toContain("forma de pagamento");
    await service.changeState(orgId, id, "running", actor());
    await drain(id, 3);
    saved = await service.get(orgId, id);
    expect(saved.status).toBe("done"); expect(saved.recipients.every(row => row.status === "sent" && !row.errorCode && !row.safeError)).toBe(true);
    expect(graph.sendMessage).toHaveBeenCalledTimes(3);
    expect(await prisma.officialSendCommand.count({ where: { organizationId: orgId, campaignRecipient: { campaignId: id } } })).toBe(2);
  });
  it("template pausado pela Meta pausa a campanha sem queimar a fila nem chamar o envio", async () => {
    await extraRecipient("Segundo lead");
    const id = await start();
    vi.mocked(graph.readTemplates).mockResolvedValue([{ ...definition, status: "PAUSED" }]);
    await drain(id, 3);
    const saved = await service.get(orgId, id);
    expect(graph.sendMessage).not.toHaveBeenCalled();
    expect(saved.status).toBe("paused"); expect(saved.recipients.every(row => row.status === "pending")).toBe(true);
    expect(saved.recipients.find(row => row.safeError)?.safeError).toContain("template");
  });
  it("tarifa alterada no meio pausa para revisão e continuar aplica a tarifa atual aos restantes", async () => {
    await extraRecipient("Segundo lead");
    const id = await start();
    await drain(id, 1);
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    await prisma.officialRate.updateMany({ where: { organizationId: orgId, wabaId: channel.wabaId! }, data: { unitRate: "0.0000099" } });
    await drain(id, 1);
    let saved = await service.get(orgId, id);
    expect(saved.status).toBe("needs_review"); expect(saved.recipients.filter(row => row.status === "pending")).toHaveLength(1);
    await service.changeState(orgId, id, "running", actor());
    await drain(id, 2);
    saved = await service.get(orgId, id);
    expect(saved.status).toBe("done"); expect(saved.recipients.every(row => row.status === "sent")).toBe(true);
    expect(graph.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("lista importada com celular sem o nono dígito envia normalmente", async () => {
    const digits = String(randomInt(10000000, 99999999)).replace(/^./, "8");
    const request: CampaignInput = { ...input, dealIds: [], importedAudience: { recipients: [{ phone: `5543${digits}`, name: "Celular antigo" }] } };
    const snapshot = await preview(orgId, request);
    expect(snapshot.eligible).toBe(1);
    const saved = await service.create(orgId, { ...request, name: "Lista antiga", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor());
    await service.approve(orgId, saved.id, snapshot.previewHash, true, actor());
    await drain(saved.id, 2);
    expect((await service.get(orgId, saved.id)).recipients[0]?.status).toBe("sent");
    expect(vi.mocked(graph.sendMessage).mock.calls[0]![2].to).toBe(`55439${digits}`);
  });
  it("template pausado no catálogo local pausa a campanha em vez de marcar todos como falha", async () => {
    await extraRecipient("Segundo lead");
    const id = await start();
    await prisma.officialTemplate.updateMany({ where: { organizationId: orgId, id: input.templateId }, data: { status: "PAUSED" } });
    await drain(id, 3);
    const saved = await service.get(orgId, id);
    expect(graph.sendMessage).not.toHaveBeenCalled();
    expect(saved.status).toBe("paused"); expect(saved.recipients.every(row => row.status === "pending")).toBe(true);
    expect(saved.recipients.find(row => row.safeError)?.safeError).toContain("não está aprovado");
  });
  it("recusa da Graph antes da submissão pausa a campanha, mesmo com código desconhecido", async () => {
    await extraRecipient("Segundo lead");
    const id = await start();
    vi.mocked(graph.readTemplates).mockRejectedValue(new graph.OfficialGraphError(2, false));
    await drain(id, 3);
    const saved = await service.get(orgId, id);
    expect(graph.sendMessage).not.toHaveBeenCalled();
    expect(saved.status).toBe("paused"); expect(saved.recipients.every(row => row.status === "pending")).toBe(true);
    expect(saved.recipients.find(row => row.safeError)?.safeError).toContain("código 2");
  });
  it("tarifa alterada com a campanha pausada é reaplicada ao continuar", async () => {
    const id = await start();
    await service.changeState(orgId, id, "paused", actor());
    await prisma.officialRate.updateMany({ where: { organizationId: orgId, wabaId: channel.wabaId! }, data: { unitRate: "0.0000077" } });
    await service.changeState(orgId, id, "running", actor());
    await drain(id, 2);
    const saved = await service.get(orgId, id);
    expect(saved.status).toBe("done"); expect(saved.recipients[0]?.status).toBe("sent");
  });
  it("quem já recebeu o template fica fora da campanha seguinte com o mesmo template", async () => {
    const id = await start(); await drain(id, 2);
    expect((await service.get(orgId, id)).recipients[0]?.status).toBe("sent");
    const again = await preview(orgId, input);
    expect(again.eligible).toBe(0); expect(again.rows[0]!.exclusion).toContain("Já recebeu este template na campanha \"Campanha fictícia\"");
    expect(again.estimate.amount).toBeNull();
    // Entrega que falhou depois do aceite libera o reenvio.
    const command = await outbound.command(orgId, (await service.get(orgId, id)).recipients[0]!.commandId!);
    await ingestReceipt(channel, { id: command!.externalMessageId!, status: "failed", timestamp: String(Math.floor(Date.now() / 1000)), errors: [{ code: 131026, title: "Não entregue" }] }, new Date());
    expect((await preview(orgId, input)).eligible).toBe(1);
    const other = { ...definition, id: String(Math.floor(Math.random() * 1e9)), name: "other_fixture" };
    vi.mocked(graph.readTemplates).mockResolvedValue([definition, other]); await sends.syncTemplates(orgId, channel.id);
    const otherTemplate = await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId, wabaId: channel.wabaId!, name: "other_fixture" } });
    expect((await preview(orgId, { ...input, templateId: otherTemplate.id })).eligible).toBe(1);
  });
  it("lead com o telefone no lugar do nome é excluído quando o template usa o nome", async () => {
    const phone = `55439${randomInt(10000000, 99999999)}`;
    const named = await prisma.client.create({ data: { organizationId: orgId, name: formatBrPhone(phone)!, phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } });
    const original = await prisma.deal.findUniqueOrThrow({ where: { id: input.dealIds[0]! } });
    const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: named.id, pipelineId: input.pipelineId, stageId: original.stageId, title: "Negócio sem nome" } });
    const result = await preview(orgId, { ...input, dealIds: [deal.id], parameters: { header: {}, body: {} }, parameterSources: { header: {}, body: { "1": "firstName" } } });
    expect(result.eligible).toBe(0); expect(result.rows[0]!.exclusion).toContain("Corrigir nomes");
  });
});
