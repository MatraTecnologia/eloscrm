import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const storage = vi.hoisted(() => ({ send: vi.fn(), uploadStream: vi.fn(), deleteFile: vi.fn() }));
vi.mock("../src/lib/storage.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/lib/storage.js")>(), r2: () => ({ send: storage.send }), uploadStream: storage.uploadStream, deleteFile: storage.deleteFile }));
import { readMedia, digestOf } from "../src/modules/whatsapp-outbound/media.service.js";
import { purgeOrganizationAssets } from "../src/modules/audit/organization-purge.service.js";
import * as sharedStorage from "../src/lib/storage.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import * as repo from "../src/modules/whatsapp-outbound/outbound.repo.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let connectionId: string;
const stamp = `${process.pid}-${Date.now()}`;
const buffer = Buffer.from("%PDF-fixture");
beforeAll(async () => {
  app = await makeApp();
  ({ orgId, cookie } = await signUpWithOrg(app, `official-media-${stamp}@eloscrm.test`, `official-media-${stamp}`));
  connectionId = (await createOfficialConnectionFixture(orgId)).connection.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => { vi.resetAllMocks(); storage.uploadStream.mockResolvedValue({}); storage.deleteFile.mockResolvedValue({}); });

describe("mídia oficial privada", () => {
  it("upload binário persiste chave gerada pelo servidor e não a retorna", async () => {
    const response = await app.inject({ method: "POST", url: `/v1/whatsapp/outbound/connections/${connectionId}/uploads?filename=contrato.pdf`, headers: { cookie, origin: env.WEB_ORIGIN, "content-type": "application/pdf" }, payload: buffer });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result).toMatchObject({ size: buffer.length, mime: "application/pdf", filename: "contrato.pdf" });
    expect(result).not.toHaveProperty("key");
    const saved = await repo.upload(orgId, connectionId, result.id);
    expect(saved?.key).toMatch(new RegExp(`^org/${orgId}/whatsapp/official/`));
    expect(saved?.digest).toBe(digestOf(buffer));
  });
  it("rejeita MIME falso, filename extra e conexão de outra imobiliária antes do storage", async () => {
    const url = `/v1/whatsapp/outbound/connections/${connectionId}/uploads?filename=file.png`;
    const response = await app.inject({ method: "POST", url, headers: { cookie, origin: env.WEB_ORIGIN, "content-type": "image/png" }, payload: Buffer.from("<svg>fake</svg>") });
    expect(response.statusCode).toBe(422);
    expect(storage.uploadStream).not.toHaveBeenCalled();
    const extra = await app.inject({ method: "POST", url: `${url}&key=foreign`, headers: { cookie, origin: env.WEB_ORIGIN, "content-type": "image/png" }, payload: buffer });
    expect(extra.statusCode).toBe(422);
    const foreign = await app.inject({ method: "POST", url: "/v1/whatsapp/outbound/connections/foreign/uploads?filename=fixture.pdf", headers: { cookie, origin: env.WEB_ORIGIN, "content-type": "application/pdf" }, payload: buffer });
    expect(foreign.statusCode).toBe(404);
    expect(storage.uploadStream).not.toHaveBeenCalled();
  });
  it("lê objeto privado limitado e confere hash e bytes efetivos", async () => {
    const upload = { key: "fixture-key", size: buffer.length, mime: "application/pdf", digest: digestOf(buffer) };
    storage.send.mockResolvedValueOnce({ ContentLength: buffer.length, Body: Readable.from([buffer.subarray(0, 5), buffer.subarray(5)]) });
    expect(await readMedia(upload)).toEqual(buffer);
    storage.send.mockResolvedValueOnce({ ContentLength: buffer.length, Body: Readable.from([Buffer.from("%PDF-changed")]) });
    await expect(readMedia(upload)).rejects.toMatchObject({ code: "OFFICIAL_MEDIA_CHANGED" });
    storage.send.mockResolvedValueOnce({ ContentLength: buffer.length, Body: Readable.from([Buffer.alloc(buffer.length + 1)]) });
    await expect(readMedia(upload)).rejects.toMatchObject({ code: "OFFICIAL_MEDIA_CHANGED" });
  });
  it("declarar objeto maior impede a leitura do stream", async () => {
    const stream = Readable.from([buffer]);
    storage.send.mockResolvedValueOnce({ ContentLength: buffer.length + 1, Body: stream });
    await expect(readMedia({ key: "fixture", size: buffer.length, mime: "application/pdf", digest: digestOf(buffer) })).rejects.toMatchObject({ code: "OFFICIAL_MEDIA_CHANGED" });
    expect(stream.readableLength).toBe(0);
    expect(stream.destroyed).toBe(true);
  });
  it("a purga inclui uploads oficiais que ainda não viraram mensagem", async () => {
    const remove = vi.spyOn(sharedStorage, "deleteFiles").mockResolvedValue([]);
    const id = randomUUID();
    const key = `org/${orgId}/whatsapp/official/unused-${id}.pdf`;
    await repo.saveUpload({ id, organizationId: orgId, connectionId, key, size: buffer.length, mime: "application/pdf", digest: digestOf(buffer), filename: "unused.pdf" });
    const result = await purgeOrganizationAssets(orgId);
    expect(remove).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([key]));
    expect(result.failedObjects).toEqual([]);
    remove.mockRestore();
    await prisma.organization.delete({ where: { id: orgId } });
    expect(await repo.uploadKeys(orgId)).toEqual([]);
  });
});
