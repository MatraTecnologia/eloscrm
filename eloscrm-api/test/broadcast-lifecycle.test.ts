import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/queue.js", async original => ({ ...await original<object>(), queueEnabled: vi.fn(() => true), enqueue: vi.fn(), createWorker: vi.fn() }));
vi.mock("../src/modules/whatsapp/conversations.service.js", async original => ({ ...await original<object>(), sendText: vi.fn() }));
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";
import { enqueue } from "../src/lib/queue.js";
import { sendText } from "../src/modules/whatsapp/conversations.service.js";
import * as permissions from "../src/modules/communication-permissions/permissions.repo.js";
import * as service from "../src/modules/broadcasts/broadcasts.service.js";
import type { CreateBroadcastInput } from "../src/modules/broadcasts/broadcasts.schema.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let foreignCookie: string;
let actorId: string;
let input: CreateBroadcastInput;
const actor = () => ({ id: actorId, name: "Gestor fictício" });
const releaseSlot = () => prisma.broadcast.updateMany({ where: { organizationId: orgId }, data: { nextAt: new Date(Date.now() - 1000) } });
beforeAll(async () => {
  app = await makeApp();
  const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `broadcast-life-${suffix}@eloscrm.test`, `broadcast-life-${suffix}`));
  ({ cookie: foreignCookie } = await signUpWithOrg(app, `broadcast-foreign-${suffix}@eloscrm.test`, `broadcast-foreign-${suffix}`));
  actorId = (await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie } })).json().user.id;
  await prisma.uazapiInstance.create({ data: { organizationId: orgId, remoteId: suffix, name: "Instância fictícia", tokenEnc: encryptToken(suffix), tokenHash: hashToken(suffix), webhookSecret: suffix, status: "connected" } });
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  vi.mocked(sendText).mockReset(); vi.mocked(enqueue).mockClear();
  vi.mocked(sendText).mockResolvedValue({ id: "message-fixture" } as Awaited<ReturnType<typeof sendText>>);
  await releaseSlot();
  const pipeline = await prisma.pipeline.create({ data: { organizationId: orgId, name: `Funil fictício ${randomUUID()}`, stages: { create: { organizationId: orgId, name: "Entrada", position: 0 } } }, include: { stages: true } });
  const dealIds: string[] = [];
  for (const phone of ["5543991112233", "5543992223344"]) {
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Pessoa fictícia", phone, phoneKey: phone.slice(2, 4) + phone.slice(-8) } });
    await permissions.save(orgId, client.id, { state: "allowed", evidence: "Permissão fictícia para teste" }, actor());
    const deal = await prisma.deal.create({ data: { organizationId: orgId, pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id, clientId: client.id, title: "Negócio fictício" } });
    dealIds.push(deal.id);
  }
  input = { pipelineId: pipeline.id, dealIds, filters: {}, text: "Olá {{nome}}", idempotencyKey: randomUUID() };
});

describe("ciclo persistente de disparos uazapi sem envio real", () => {
  it("pausa, retoma e impede repetição dos destinatários concluídos", async () => {
    const saved = await service.create(orgId, input, actor());
    await service.changeState(orgId, saved.id, "PAUSED", actor());
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    expect(sendText).not.toHaveBeenCalled();
    await service.changeState(orgId, saved.id, "RUNNING", actor());
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    const cooldown = (await service.getById(orgId, saved.id)).nextAt;
    await service.changeState(orgId, saved.id, "PAUSED", actor());
    await service.changeState(orgId, saved.id, "RUNNING", actor());
    expect((await service.getById(orgId, saved.id)).nextAt).toEqual(cooldown);
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    await releaseSlot(); await service.processRecipient({ recipientId: saved.recipients[1]!.id });
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(await service.getById(orgId, saved.id)).toMatchObject({ status: "DONE", sent: 2, failed: 0 });
  });
  it("registra falha individual e continua com o próximo destino", async () => {
    const saved = await service.create(orgId, input, actor());
    vi.mocked(sendText).mockRejectedValueOnce(Object.assign(new Error("Detalhe privado do provedor"), { code: "WHATSAPP_BLOCKED" }));
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    await releaseSlot(); await service.processRecipient({ recipientId: saved.recipients[1]!.id });
    const current = await service.getById(orgId, saved.id);
    expect(current).toMatchObject({ status: "DONE", sent: 1, failed: 1 });
    expect(current.recipients.find(row => row.status === "FAILED")).toMatchObject({ errorCode: "WHATSAPP_BLOCKED", errorStage: "provider", attempts: 1, completedAt: expect.any(Date) });
    expect(JSON.stringify(current)).not.toContain("Detalhe privado");
  });
  it("marca timeout como incerto e não repete; também recupera lease vencida", async () => {
    const saved = await service.create(orgId, input, actor());
    vi.mocked(sendText).mockRejectedValueOnce(new Error("Timeout fictício"));
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    await prisma.broadcastRecipient.update({ where: { id: saved.recipients[1]!.id }, data: { status: "PROCESSING", leaseExpiresAt: new Date(Date.now() - 1000), attempts: 1 } });
    await service.recoverBroadcasts(); await service.recoverBroadcasts();
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(await service.getById(orgId, saved.id)).toMatchObject({ status: "DONE", uncertain: 2, sent: 0 });
  });
  it("encerra os destinos pendentes e recusa retomada", async () => {
    const saved = await service.create(orgId, input, actor());
    await service.processRecipient({ recipientId: saved.recipients[0]!.id });
    await service.cancel(orgId, saved.id, actor());
    await service.processRecipient({ recipientId: saved.recipients[1]!.id });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(await service.getById(orgId, saved.id)).toMatchObject({ status: "CANCELED", sent: 1, skipped: 1 });
    await expect(service.changeState(orgId, saved.id, "RUNNING", actor())).rejects.toMatchObject({ code: "BROADCAST_FINISHED" });
  });
  it("deduplica confirmação e jobs concorrentes sem somar resultados duas vezes", async () => {
    const [first, second] = await Promise.all([service.create(orgId, input, actor()), service.create(orgId, input, actor())]);
    expect(second.id).toBe(first.id);
    await Promise.all([service.processRecipient({ recipientId: first.recipients[0]!.id }), service.processRecipient({ recipientId: first.recipients[0]!.id })]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect((await service.getById(orgId, first.id)).sent).toBe(1);
    await expect(service.create(orgId, { ...input, text: "Outra mensagem" }, actor())).rejects.toMatchObject({ code: "BROADCAST_IDEMPOTENCY" });
  });
  it("recupera pendentes após reinício e protege os controles por tenant e origem", async () => {
    const saved = await service.create(orgId, input, actor());
    vi.mocked(enqueue).mockClear(); await service.recoverBroadcasts();
    expect(enqueue).toHaveBeenCalledWith(service.BROADCAST_QUEUE, { recipientId: saved.recipients[0]!.id }, expect.objectContaining({ attempts: 1 }));
    const url = `/v1/broadcasts/${saved.id}/pause`;
    expect((await app.inject({ method: "POST", url, headers: { cookie: foreignCookie, origin: env.WEB_ORIGIN }, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: { cookie, origin: "https://example.invalid" }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: { cookie, origin: env.WEB_ORIGIN }, payload: {} })).statusCode).toBe(200);
  });
  it("envia lista importada sem criar leads ou cards e deduplica os números", async () => {
    const counts = [await prisma.client.count({ where: { organizationId: orgId } }), await prisma.deal.count({ where: { organizationId: orgId } })];
    const imported: CreateBroadcastInput = { ...input, dealIds: [], importedAudience: { recipients: [{ phone: "5543999990001", name: "Pessoa importada" }, { phone: "5543999990001", name: "Pessoa repetida" }], consent: { confirmed: true, evidence: "Autorização fictícia da lista" } } };
    const saved = await service.create(orgId, imported, actor());
    expect(saved.skipped).toBe(1);
    for (const row of saved.recipients) { await releaseSlot(); await service.processRecipient({ recipientId: row.id }); }
    expect(sendText).toHaveBeenCalledTimes(1); expect(vi.mocked(sendText).mock.calls[0]![2].text).toBe("Olá Pessoa");
    expect([await prisma.client.count({ where: { organizationId: orgId } }), await prisma.deal.count({ where: { organizationId: orgId } })]).toEqual(counts);
  });
  it("protege o upload por sessão e origem e rejeita lista sem autorização", async () => {
    const url = "/v1/broadcasts/imports/preview";
    const payload = { filename: "contacts.csv", content: Buffer.from("phone,name\n5543999990001,Pessoa").toString("base64") };
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie, origin: "https://example.invalid" }, payload })).statusCode).toBe(403);
    const response = await app.inject({ method: "POST", url, headers: { cookie, origin: env.WEB_ORIGIN }, payload });
    expect(response.statusCode).toBe(200); expect(response.json().valid).toBe(1);
    const invalid = await app.inject({ method: "POST", url: "/v1/broadcasts", headers: { cookie, origin: env.WEB_ORIGIN }, payload: { ...input, dealIds: [], importedAudience: { recipients: [{ phone: "5543999990001", name: "Pessoa" }], consent: { confirmed: false, evidence: "Teste" } } } });
    expect(invalid.statusCode).toBe(422);
  });

});
