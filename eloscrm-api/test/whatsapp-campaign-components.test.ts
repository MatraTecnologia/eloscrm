import { randomInt, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const storage = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../src/lib/storage.js", async original => ({ ...await original<typeof import("../src/lib/storage.js")>(), r2: () => ({ send: storage.send }) }));
vi.mock("../src/lib/whatsapp-official/graph.js", async original => ({ ...await original<typeof import("../src/lib/whatsapp-official/graph.js")>(), sendMessage: vi.fn(), readTemplates: vi.fn(), uploadMedia: vi.fn() }));
vi.mock("../src/lib/queue.js", async original => ({ ...await original<typeof import("../src/lib/queue.js")>(), queueEnabled: vi.fn(() => true), enqueue: vi.fn(), createWorker: vi.fn() }));
import * as graph from "../src/lib/whatsapp-official/graph.js";
import { prisma } from "../src/lib/prisma.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { digestOf } from "../src/modules/whatsapp-outbound/media.service.js";
import * as outbound from "../src/modules/whatsapp-outbound/outbound.repo.js";
import { syncTemplates } from "../src/modules/whatsapp-outbound/outbound.service.js";
import { preview } from "../src/modules/whatsapp-campaigns/preview.service.js";
import * as service from "../src/modules/whatsapp-campaigns/campaigns.service.js";
import { processCampaign } from "../src/modules/whatsapp-campaigns/dispatch.service.js";
import * as permissions from "../src/modules/communication-permissions/permissions.repo.js";
import type { CampaignInput } from "../src/modules/whatsapp-campaigns/campaigns.schema.js";
import type { TemplateDefinition } from "../src/modules/whatsapp-outbound/outbound.schema.js";

let app: FastifyInstance;
let orgId: string;
let actorId: string;
let input: CampaignInput;
let definition: TemplateDefinition;
const buffer = Buffer.from("%PDF-campaign-fixture");
const actor = () => ({ id: actorId, name: "Gestor fictício" });
beforeAll(async () => {
  app = await makeApp();
  const suffix = randomUUID();
  const session = await signUpWithOrg(app, `campaign-components-${suffix}@eloscrm.test`, `campaign-components-${suffix}`);
  orgId = session.orgId;
  actorId = (await app.inject({ url: "/api/auth/get-session", headers: { cookie: session.cookie } })).json().user.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  vi.clearAllMocks();
  storage.send.mockImplementation(async () => ({ ContentLength: buffer.length, Body: Readable.from([buffer]) }));
  const { connection } = await createOfficialConnectionFixture(orgId);
  const channel = (await outbound.connection(orgId, connection.id))!;
  const pipeline = await prisma.pipeline.create({ data: { organizationId: orgId, name: `Funil ${randomUUID()}`, stages: { create: { organizationId: orgId, name: "Entrada", position: 0 } } }, include: { stages: true } });
  const phone = `5543${randomInt(100000000, 999999999)}`;
  const client = await prisma.client.create({ data: { organizationId: orgId, name: "Cliente fictício", phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } });
  const contact = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId: client.id } });
  await prisma.contactIdentity.create({ data: { organizationId: orgId, contactId: contact.id, connectionId: connection.id, scope: `business:${channel.businessPortfolioId}`, kind: "wa_id", value: phone, source: "provider" } });
  await permissions.save(orgId, client.id, { state: "allowed", evidence: "Permissão fictícia para teste" }, actor());
  const deal = await prisma.deal.create({ data: { organizationId: orgId, clientId: client.id, pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id, title: "Negócio fictício" } });
  definition = { id: String(randomInt(1, 1_000_000_000)), name: "campaign_document_fixture", language: "pt_BR", category: "UTILITY", status: "APPROVED", components: [{ type: "HEADER", format: "DOCUMENT" }, { type: "BODY", text: "Olá {{1}}" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/appointment/{{1}}" }] }] };
  vi.mocked(graph.readTemplates).mockResolvedValue([definition]);
  await syncTemplates(orgId, connection.id);
  const template = await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId, wabaId: channel.wabaId! } });
  const upload = await outbound.saveUpload({ id: randomUUID(), organizationId: orgId, connectionId: connection.id, key: `org/${orgId}/whatsapp/official/${randomUUID()}.pdf`, mime: "application/pdf", size: buffer.length, filename: "appointment.pdf", digest: digestOf(buffer) });
  input = { connectionId: connection.id, pipelineId: pipeline.id, filters: {}, dealIds: [deal.id], templateId: template.id, headerUploadId: upload.id, parameters: { header: {}, body: {}, buttons: { "0": "appointment-123" } }, parameterSources: { header: {}, body: { "1": "firstName" } } };
  vi.mocked(graph.uploadMedia).mockResolvedValue("123456");
  vi.mocked(graph.sendMessage).mockResolvedValue({ messages: [{ id: `wamid.${randomUUID()}` }] });
});
const draft = async () => {
  const snapshot = await preview(orgId, input);
  const request = { ...input, name: "Campanha com documento", idempotencyKey: randomUUID(), previewHash: snapshot.previewHash };
  const saved = await service.create(orgId, request, actor());
  expect((await service.create(orgId, structuredClone(request), actor())).id).toBe(saved.id);
  return saved;
};
const start = async () => {
  const saved = await draft();
  await service.approve(orgId, saved.id, (saved.snapshot as { previewHash: string }).previewHash, true, actor());
  return saved.id;
};

describe("campanhas com cabeçalho privado e botões dinâmicos", () => {
  it("congela arquivo e URL completa na prévia e envia os mesmos componentes", async () => {
    const snapshot = await preview(orgId, input);
    expect(snapshot.headerMedia).toMatchObject({ uploadId: input.headerUploadId, digest: digestOf(buffer), filename: "appointment.pdf", mime: "application/pdf" });
    expect(snapshot.headerMedia).not.toHaveProperty("key");
    expect(snapshot.rows[0]).toMatchObject({ text: "Olá Cliente\nhttps://example.com/appointment/appointment-123", parameters: { body: { "1": "Cliente" }, buttons: { "0": "appointment-123" } } });
    const id = await start();
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(graph.sendMessage).mock.calls[0]![2];
    expect(payload.template).toMatchObject({ components: expect.arrayContaining([
      { type: "header", parameters: [{ type: "document", document: { id: "123456", filename: "appointment.pdf" } }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "appointment-123" }] },
    ]) });
  });
  it("upload de outro número ou arquivo com bytes alterados impede a prévia", async () => {
    const other = await createOfficialConnectionFixture(orgId);
    await prisma.officialUpload.update({ where: { id: input.headerUploadId! }, data: { connectionId: other.connection.id } });
    await expect(preview(orgId, input)).rejects.toMatchObject({ code: "CAMPAIGN_MEDIA" });
    expect(storage.send).not.toHaveBeenCalled();
    await prisma.officialUpload.update({ where: { id: input.headerUploadId! }, data: { connectionId: input.connectionId } });
    storage.send.mockImplementation(async () => ({ ContentLength: buffer.length, Body: Readable.from([Buffer.alloc(buffer.length)]) }));
    await expect(preview(orgId, input)).rejects.toMatchObject({ code: "OFFICIAL_MEDIA_CHANGED" });
  });
  it("mudança no arquivo após aprovação pausa a campanha antes de submeter", async () => {
    const id = await start();
    await prisma.officialUpload.update({ where: { id: input.headerUploadId! }, data: { filename: "changed.pdf" } });
    await processCampaign({ orgId, campaignId: id });
    expect(graph.sendMessage).not.toHaveBeenCalled();
    expect((await service.get(orgId, id)).status).toBe("needs_review");
  });
});
