import { randomUUID, randomInt } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
vi.mock("../src/lib/whatsapp-official/graph.js", async original => ({ ...await original<object>(), sendMessage: vi.fn(), readTemplates: vi.fn() }));
vi.mock("../src/lib/queue.js", async original => ({ ...await original<object>(), queueEnabled: vi.fn(() => true), enqueue: vi.fn(async () => undefined), createWorker: vi.fn() }));
import * as graph from "../src/lib/whatsapp-official/graph.js";
import { prisma } from "../src/lib/prisma.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import * as campaigns from "../src/modules/whatsapp-campaigns/campaigns.service.js";
import { preview } from "../src/modules/whatsapp-campaigns/preview.service.js";
import { processCampaign } from "../src/modules/whatsapp-campaigns/dispatch.service.js";
import * as permissions from "../src/modules/communication-permissions/permissions.repo.js";
import * as sends from "../src/modules/whatsapp-outbound/outbound.service.js";
import * as outbound from "../src/modules/whatsapp-outbound/outbound.repo.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import * as inbox from "../src/modules/whatsapp-inbox/inbox.service.js";
import type { CampaignInput } from "../src/modules/whatsapp-campaigns/campaigns.schema.js";
import type { ChannelConnection } from "../src/generated/prisma/client.js";

let app: FastifyInstance; let orgId: string; let foreignOrgId: string; let cookie: string; let actorId: string;
let channel: ChannelConnection; let input: CampaignInput; let phone: string; let clientId: string; let contactId: string;
let sequence = 0;
const actor = () => ({ id: actorId, name: "Gestor fictício" });
const all = { filter: "all" as const, limit: 100 };
const dispatched = { filter: "broadcasts" as const, limit: 100 };
const inbound = (from: string, sentAt: Date) => ingestMessage(channel, { id: `inbound-${randomUUID()}`, from, type: "text", text: { body: "Mensagem fictícia" }, timestamp: String(Math.floor(sentAt.getTime() / 1000)) }, [], "cloud_api", sentAt);
const conversationOf = () => prisma.conversation.findFirst({ where: { organizationId: orgId, connectionId: channel.id, messagingContactId: contactId } });

beforeAll(async () => {
  app = await makeApp(); const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `campaign-inbox-${suffix}@eloscrm.test`, `campaign-inbox-${suffix}`));
  ({ orgId: foreignOrgId } = await signUpWithOrg(app, `campaign-inbox-other-${suffix}@eloscrm.test`, `campaign-inbox-other-${suffix}`));
  actorId = (await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie } })).json().user.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  vi.mocked(graph.sendMessage).mockReset(); vi.mocked(graph.readTemplates).mockReset();
  const fixture = await createOfficialConnectionFixture(orgId); channel = (await outbound.connection(orgId, fixture.connection.id))!;
  const pipeline = await prisma.pipeline.create({ data: { organizationId: orgId, name: `Funil fictício ${randomUUID()}`, stages: { create: { organizationId: orgId, name: "Entrada", position: 0 } } }, include: { stages: true } });
  phone = `5543${randomInt(100000000, 999999999)}`;
  const client = await prisma.client.create({ data: { organizationId: orgId, name: `Pessoa da campanha ${sequence++}`, phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } }); clientId = client.id;
  const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId } }); contactId = contact.id;
  await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId, connectionId: channel.id, scope: `business:${channel.businessPortfolioId}`, kind: "wa_id", value: phone, source: "provider", validFrom: new Date(Date.now() - 60000) } });
  await permissions.save(orgId, clientId, { state: "allowed", evidence: "Autorização fictícia para teste" }, actor());
  const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId, pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id, title: "Negócio fictício" } });
  const definition = { id: String(randomInt(1, 1e9)), name: "campaign_inbox_fixture", status: "APPROVED", category: "MARKETING", language: "pt_BR", components: [{ type: "BODY", text: "Informação fictícia {{1}}" }] };
  vi.mocked(graph.readTemplates).mockResolvedValue([definition]); await sends.syncTemplates(orgId, channel.id);
  const template = await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId, wabaId: channel.wabaId! } });
  input = { connectionId: channel.id, pipelineId: pipeline.id, filters: {}, dealIds: [deal.id], templateId: template.id, parameters: { header: {}, body: { "1": "Exemplo" } } };
  await prisma.officialRate.create({ data: { organizationId: orgId, wabaId: channel.wabaId!, country: "BR", category: "MARKETING", pricingType: "REGULAR", currency: channel.currency!, unitRate: "0.0000012345", volumeFrom: 0, validFrom: new Date("2026-01-01"), validUntil: new Date("2027-01-01"), sourceUrl: "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing", createdById: actorId } });
  vi.mocked(graph.sendMessage).mockResolvedValue({ messages: [{ id: `wamid.${randomUUID()}` }] });
});

const runCampaign = async () => {
  const snapshot = await preview(orgId, input);
  const saved = await campaigns.create(orgId, { ...input, name: "Campanha fictícia", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor());
  await campaigns.approve(orgId, saved.id, (saved.snapshot as { previewHash: string }).previewHash, true, actor());
  await processCampaign({ orgId, campaignId: saved.id });
  const recipient = (await campaigns.get(orgId, saved.id)).recipients[0]!;
  expect(recipient.status).toBe("sent");
  return { campaignId: saved.id, command: (await outbound.command(orgId, recipient.commandId!))! };
};

describe("campanha oficial fora da ordem da central", () => {
  it("não reordena conversa em atendimento e lista o contato em disparos com o horário do envio", async () => {
    const attendedAt = new Date(Date.now() - 3_600_000);
    await inbound(phone, attendedAt);
    const recentId = await inbound(`5543${randomInt(100000000, 999999999)}`, new Date(Date.now() - 60_000));
    const { command } = await runCampaign();

    const conversation = (await conversationOf())!;
    expect(conversation.lastMessageAt?.getTime()).toBe(Math.floor(attendedAt.getTime() / 1000) * 1000);
    const ids = (await inbox.list(orgId, all)).items.map(item => item.id);
    const recent = (await prisma.conversation.findFirstOrThrow({ where: { id: recentId } })).messagingContactId;
    expect(ids.indexOf(`contact:${recent}`)).toBeLessThan(ids.indexOf(`client:${clientId}`));

    const listed = (await inbox.list(orgId, dispatched)).items.find(item => item.id === `client:${clientId}`);
    const sentAt = (await prisma.whatsappMessage.findFirstOrThrow({ where: { id: command.messageId } })).sentAt;
    expect(listed?.listedAt.getTime()).toBe(sentAt.getTime());
    expect((await inbox.list(foreignOrgId, dispatched)).items).toEqual([]);
  });

  it("eco e histórico da mensagem da campanha não movem a conversa", async () => {
    const attendedAt = new Date(Date.now() - 3_600_000);
    await inbound(phone, attendedAt);
    const { command } = await runCampaign();
    const before = (await conversationOf())!.lastMessageAt;
    for (const origin of ["business_app", "history"] as const) {
      await ingestMessage(channel, { id: command.externalMessageId!, to: phone, type: "text", text: { body: "Informação fictícia Exemplo" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], origin, new Date());
    }
    expect((await conversationOf())!.lastMessageAt).toEqual(before);
  });

  it("eco que chega antes do accept não sobe a conversa da campanha", async () => {
    const snapshot = await preview(orgId, input);
    const saved = await campaigns.create(orgId, { ...input, name: "Campanha fictícia", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash }, actor());
    await campaigns.approve(orgId, saved.id, (saved.snapshot as { previewHash: string }).previewHash, true, actor());
    const externalId = `wamid.${randomUUID()}`;
    vi.mocked(graph.sendMessage).mockImplementationOnce(async () => {
      await ingestMessage(channel, { id: externalId, to: phone, type: "text", text: { body: "Informação fictícia Exemplo" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "business_app", new Date());
      return { messages: [{ id: externalId }] };
    });
    await processCampaign({ orgId, campaignId: saved.id });
    expect((await campaigns.get(orgId, saved.id)).recipients[0]!.status).toBe("sent");
    expect((await conversationOf())!.lastMessageAt).toBeNull();
    expect((await inbox.list(orgId, all)).items.map(item => item.id)).not.toContain(`client:${clientId}`);
  });

  it("conversa aberta por envio manual continua na central mesmo sem lastMessageAt", async () => {
    const identityId = (await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, contactId } })).id;
    // contato novo, sem janela de 24h: o primeiro envio manual só pode ser template
    await sends.createSend(orgId, channel.id, { type: "template", templateId: input.templateId, parameters: input.parameters, identityId, idempotencyKey: randomUUID() }, actor());
    expect((await conversationOf())!.lastMessageAt).toBeNull();
    expect((await inbox.list(orgId, all)).items.map(item => item.id)).toContain(`client:${clientId}`);
  });

  it("conversa criada pela campanha só entra na central quando o lead responde", async () => {
    await runCampaign();
    expect((await conversationOf())!.lastMessageAt).toBeNull();
    expect((await inbox.list(orgId, all)).items.map(item => item.id)).not.toContain(`client:${clientId}`);
    expect((await inbox.list(orgId, { ...all, filter: "unread" })).items.map(item => item.id)).not.toContain(`client:${clientId}`);
    const name = (await prisma.client.findFirstOrThrow({ where: { id: clientId } })).name;
    expect((await inbox.list(orgId, { ...all, q: name })).items.map(item => item.id)).toEqual([`client:${clientId}`]);
    expect((await inbox.list(orgId, dispatched)).items.map(item => item.id)).toContain(`client:${clientId}`);

    await inbound(phone, new Date());
    const first = (await inbox.list(orgId, all)).items[0]!;
    expect(first.id).toBe(`client:${clientId}`);
    expect(first.unreadCount).toBe(1);
  });

  it("disparo encerrado há mais de 24h sai da aba", async () => {
    const { campaignId, command } = await runCampaign();
    const ids = async () => (await inbox.list(orgId, dispatched)).items.map(item => item.id);
    await prisma.officialCampaign.update({ where: { id: campaignId }, data: { status: "done" } });
    expect(await ids()).toContain(`client:${clientId}`);
    await prisma.whatsappMessage.update({ where: { id: command.messageId }, data: { sentAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect(await ids()).not.toContain(`client:${clientId}`);
    await prisma.officialCampaign.update({ where: { id: campaignId }, data: { status: "needs_review" } });
    expect(await ids()).toContain(`client:${clientId}`);
  });

  it("envio manual fora de campanha continua subindo a conversa", async () => {
    await inbound(phone, new Date(Date.now() - 3_600_000));
    const conversation = (await conversationOf())!;
    const identityId = (await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgId, contactId } })).id;
    const sent = await sends.createSend(orgId, channel.id, { type: "text", text: "Resposta manual fictícia", identityId, idempotencyKey: randomUUID() }, actor());
    await sends.executeSend(orgId, sent.id);
    expect((await conversationOf())!.lastMessageAt!.getTime()).toBeGreaterThan(conversation.lastMessageAt!.getTime());
  });
});
