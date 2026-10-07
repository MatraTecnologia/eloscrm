import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const remote = vi.hoisted(() => ({ metadata: vi.fn(), download: vi.fn(), upload: vi.fn(), remove: vi.fn(), signed: vi.fn() }));
vi.mock("../src/lib/whatsapp-official/graph.js", async original => ({ ...await original<typeof import("../src/lib/whatsapp-official/graph.js")>(), readMediaMetadata: remote.metadata }));
vi.mock("../src/lib/whatsapp-official/media-download.js", async original => ({ ...await original<typeof import("../src/lib/whatsapp-official/media-download.js")>(), downloadOfficialMedia: remote.download }));
vi.mock("../src/lib/storage.js", async original => ({ ...await original<typeof import("../src/lib/storage.js")>(), uploadStream: remote.upload, deleteFile: remote.remove, getDownloadUrl: remote.signed }));
import { finishMedia } from "../src/modules/whatsapp-official/media.repo.js";
import { processOfficialMediaJob } from "../src/modules/whatsapp-official/media.service.js";
import { digestOf } from "../src/modules/whatsapp-outbound/media.service.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let connectionId: string;
let conversationId: string;
const buffer = Buffer.from("%PDF-incoming-fixture");
beforeAll(async () => {
  app = await makeApp();
  const stamp = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `incoming-${stamp}@eloscrm.test`, `incoming-${stamp}`));
  connectionId = (await createOfficialConnectionFixture(orgId)).connection.id;
  const contact = await prisma.messagingContact.create({ data: { organizationId: orgId } });
  conversationId = (await prisma.conversation.create({ data: { organizationId: orgId, connectionId, messagingContactId: contact.id, chatid: `contact:${contact.id}` } })).id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => {
  vi.resetAllMocks();
  remote.metadata.mockResolvedValue({ id: "123", url: "https://lookaside.fbsbx.com/file", mime_type: "application/pdf", file_size: String(buffer.length), sha256: digestOf(buffer) });
  remote.download.mockResolvedValue(buffer); remote.upload.mockResolvedValue({}); remote.remove.mockResolvedValue({}); remote.signed.mockResolvedValue("https://storage.example.test/private");
});
const createMessage = () => prisma.whatsappMessage.create({ data: { organizationId: orgId, connectionId, conversationId, providerId: randomUUID(), officialMediaId: "123", origin: "cloud_api", direction: "inbound", type: "document", mediaStatus: "pending", sentAt: new Date() } });

describe("download persistido da mídia recebida oficial", () => {
  it("claims concorrentes baixam uma vez e guardam apenas arquivo privado", async () => {
    const message = await createMessage();
    const job = { organizationId: orgId, messageId: message.id };
    await Promise.all([processOfficialMediaJob(job), processOfficialMediaJob(job)]);
    expect(remote.download).toHaveBeenCalledTimes(1);
    const saved = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(saved).toMatchObject({ mediaStatus: "ready", mediaAttempts: 1, mediaLeaseToken: null, mediaTempUrl: null, mediaSize: buffer.length });
    expect(saved.mediaKey).toMatch(new RegExp(`^org/${orgId}/whatsapp/${conversationId}/official/`));
    await processOfficialMediaJob(job);
    expect(remote.download).toHaveBeenCalledTimes(1);
  });
  it("tenant incorreto não chama provedor; GET e retry exigem sessão e ownership", async () => {
    const message = await createMessage();
    await processOfficialMediaJob({ organizationId: "foreign", messageId: message.id });
    expect(remote.metadata).not.toHaveBeenCalled();
    expect((await app.inject({ url: `/v1/whatsapp/official-media/${message.id}` })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/whatsapp/official-media/foreign", headers: { cookie } })).statusCode).toBe(404);
  });
  it("hash incorreto marca falha sem perder mensagem e retry protege origem", async () => {
    const message = await createMessage();
    remote.download.mockResolvedValue(Buffer.from("%PDF-changed"));
    await processOfficialMediaJob({ organizationId: orgId, messageId: message.id });
    const saved = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(saved).toMatchObject({ mediaStatus: "failed", mediaLeaseToken: null });
    expect(saved.mediaError).not.toContain("lookaside");
    expect(remote.upload).not.toHaveBeenCalled();
    const refused = await app.inject({ method: "POST", url: `/v1/whatsapp/official-media/${message.id}/retry`, headers: { cookie, origin: "https://foreign.test" }, payload: {} });
    expect(refused.statusCode).toBe(403);
    const waiting = await app.inject({ method: "POST", url: `/v1/whatsapp/official-media/${message.id}/retry`, headers: { cookie, origin: env.WEB_ORIGIN }, payload: {} });
    expect(waiting.statusCode).toBe(429);
  });
  it("expiração da lease permite recuperar e dono antigo não sobrescreve novo objeto", async () => {
    const message = await createMessage();
    await prisma.whatsappMessage.update({ where: { id: message.id }, data: { mediaLeaseToken: "old-lease-fixture", mediaLeaseExpiresAt: new Date(Date.now() - 1000) } });
    await processOfficialMediaJob({ organizationId: orgId, messageId: message.id });
    expect((await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } })).mediaStatus).toBe("ready");
    expect((await finishMedia(orgId, message.id, "old-lease-fixture", { key: "old-object", mime: "application/pdf", size: 1 })).count).toBe(0);
  });
  it("renova mídia enviada pelo CRM sem exigir ID de mídia recebido", async () => {
    const message = await createMessage();
    await prisma.whatsappMessage.update({ where: { id: message.id }, data: { officialMediaId: null, direction: "outbound", mediaStatus: "ready", mediaKey: `org/${orgId}/whatsapp/${conversationId}/official/uploaded.pdf` } });
    const result = await app.inject({ url: `/v1/whatsapp/official-media/${message.id}?download=1`, headers: { cookie } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toHaveProperty("url", "https://storage.example.test/private");
    expect(remote.signed).toHaveBeenCalledWith(expect.any(String), expect.any(String), 600, "file");
  });
  it("remove objeto quando a mensagem foi excluída durante upload", async () => {
    const message = await createMessage();
    remote.upload.mockImplementation(async () => { await prisma.whatsappMessage.delete({ where: { id: message.id } }); });
    await processOfficialMediaJob({ organizationId: orgId, messageId: message.id });
    expect(remote.remove).toHaveBeenCalledTimes(1);
  });
});
