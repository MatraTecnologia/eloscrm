import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// o segredo anterior precisa estar no ambiente antes de o env.ts ser avaliado
const previousSecret = vi.hoisted(() => {
  const value = `previous-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  process.env.HUB_WEBHOOK_SECRET_PREVIOUS = value;
  return value;
});

import type { FastifyInstance } from "fastify";
import { env } from "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import { dispatchDueEvents } from "../src/modules/meta-hub/webhook.service.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";

let app: FastifyInstance;
let orgA: string;
let orgB: string;
const workspaceA = `ws_${randomUUID()}`;
const workspaceB = `ws_${randomUUID()}`;
let hubConnectionB: string;

beforeAll(async () => {
  app = await makeApp();
  ({ orgId: orgA } = await signUpWithOrg(app, `hub-a-${randomUUID()}@eloscrm.test`, `hub-a-${randomUUID()}`));
  ({ orgId: orgB } = await signUpWithOrg(app, `hub-b-${randomUUID()}@eloscrm.test`, `hub-b-${randomUUID()}`));
  await prisma.organization.update({ where: { id: orgA }, data: { hubWorkspaceId: workspaceA } });
  await prisma.organization.update({ where: { id: orgB }, data: { hubWorkspaceId: workspaceB } });
  const fixture = await createOfficialConnectionFixture(orgB);
  hubConnectionB = `conn_${randomUUID()}`;
  await prisma.channelConnection.update({ where: { id: fixture.connection.id }, data: { hubConnectionId: hubConnectionB } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const nowSeconds = () => Math.floor(Date.now() / 1000);
const envelopeOf = (overrides: Record<string, unknown> = {}) => ({
  id: `evt_${randomUUID()}`, type: "whatsapp.message.received", createdAt: new Date().toISOString(),
  workspace: { id: workspaceA, externalId: orgA }, connectionId: null, data: {}, meta: null, ...overrides,
});
const sign = (secret: string, timestamp: string, raw: string) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`;
const deliver = (body: unknown, options: { secret?: string; timestamp?: string; signature?: string; headers?: Record<string, string | string[]> } = {}) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = options.timestamp ?? String(nowSeconds());
  return app.inject({
    method: "POST", url: "/webhooks/meta-hub", payload: raw,
    headers: {
      "content-type": "application/json", "x-hub-timestamp": timestamp,
      "x-hub-signature": options.signature ?? sign(options.secret ?? env.HUB_WEBHOOK_SECRET!, timestamp, raw),
      ...options.headers,
    },
  });
};
const stored = (hubEventId: string) => prisma.hubWebhookEvent.findMany({ where: { hubEventId } });

describe("receptor do webhook do Meta Hub", () => {
  it("assinatura válida grava o evento pendente com o tenant do workspace e responde 200", async () => {
    const envelope = envelopeOf();
    const response = await deliver(envelope);
    expect(response.statusCode).toBe(200);
    const [row] = await stored(envelope.id);
    expect(row).toMatchObject({ status: "pending", organizationId: orgA, connectionId: null, type: envelope.type, hubWorkspaceId: workspaceA });
    expect(row.envelopeAt.toISOString()).toBe(envelope.createdAt);
  });

  it("assinatura de outro segredo é recusada com 401 e nada é gravado", async () => {
    const envelope = envelopeOf();
    const response = await deliver(envelope, { secret: randomBytes(32).toString("hex") });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("HUB_WEBHOOK_SIGNATURE_INVALID");
    expect(await stored(envelope.id)).toHaveLength(0);
  });

  it("corpo alterado depois de assinado é recusado", async () => {
    const envelope = envelopeOf();
    const timestamp = String(nowSeconds());
    const signature = sign(env.HUB_WEBHOOK_SECRET!, timestamp, JSON.stringify(envelope));
    const response = await deliver({ ...envelope, type: "connection.updated" }, { timestamp, signature });
    expect(response.statusCode).toBe(401);
  });

  it("timestamp fora de 5 minutos é recusado mesmo com a assinatura certa", async () => {
    for (const offset of [-301, 301]) {
      const envelope = envelopeOf();
      const response = await deliver(envelope, { timestamp: String(nowSeconds() + offset) });
      expect(response.statusCode).toBe(401);
      expect(await stored(envelope.id)).toHaveLength(0);
    }
  });

  it("headers fora do formato são recusados sem calcular o HMAC", async () => {
    const hmac = vi.spyOn(createHmac("sha256", "x").constructor.prototype, "update");
    const envelope = envelopeOf();
    const raw = JSON.stringify(envelope);
    const timestamp = String(nowSeconds());
    const good = sign(env.HUB_WEBHOOK_SECRET!, timestamp, raw);
    const cases: Record<string, string | string[]>[] = [
      { "x-hub-signature": good.slice(7) }, { "x-hub-signature": good.toUpperCase() }, { "x-hub-signature": [good, good] },
      { "x-hub-timestamp": "12.5" }, { "x-hub-timestamp": "" }, { "x-hub-timestamp": "abc" },
    ];
    hmac.mockClear();
    for (const headers of cases) expect((await deliver(raw, { timestamp, signature: good, headers })).statusCode).toBe(401);
    expect(hmac).not.toHaveBeenCalled();
    // controle: a entrega válida passa pelo mesmo espião
    expect((await deliver(raw, { timestamp, signature: good })).statusCode).toBe(200);
    expect(hmac).toHaveBeenCalled();
  });

  it("aceita o segredo anterior durante a rotação", async () => {
    expect(env.HUB_WEBHOOK_SECRET_PREVIOUS).toBe(previousSecret);
    const envelope = envelopeOf();
    expect((await deliver(envelope, { secret: previousSecret })).statusCode).toBe(200);
    expect(await stored(envelope.id)).toHaveLength(1);
  });

  it("id repetido grava uma linha só e responde 200 nas duas entregas", async () => {
    const envelope = envelopeOf();
    expect((await deliver(envelope)).statusCode).toBe(200);
    expect((await deliver(envelope)).statusCode).toBe(200);
    expect(await stored(envelope.id)).toHaveLength(1);
  });

  it("aceita entrega acima de 1 MiB: um 413 gastaria as tentativas do hub até failed", async () => {
    const envelope = envelopeOf({ data: { blob: randomBytes(1024 * 1024).toString("hex") } });
    const response = await deliver(envelope);
    expect(response.statusCode).toBe(200);
    expect(await stored(envelope.id)).toHaveLength(1);
  });

  it("tipo desconhecido, Lead Ads e conexão que não é de WhatsApp ficam unsupported com 2xx", async () => {
    const envelopes = [
      envelopeOf({ type: "whatsapp.algo.novo" }),
      envelopeOf({ type: "leadgen.lead.created" }),
      envelopeOf({ type: "connection.created", data: { kind: "lead_ads", whatsapp: null } }),
      envelopeOf({ type: "connection.created", data: { kind: "instagram" } }),
    ];
    for (const envelope of envelopes) {
      expect((await deliver(envelope)).statusCode).toBe(200);
      expect((await stored(envelope.id))[0]).toMatchObject({ status: "unsupported", organizationId: null });
    }
    const whatsapp = envelopeOf({ type: "connection.created", data: { kind: "whatsapp", whatsapp: null } });
    await deliver(whatsapp);
    expect((await stored(whatsapp.id))[0].status).toBe("pending");
  });

  it("o limite por segundo conta pelo x-real-ip: o excesso de um cliente não bloqueia o hub", async () => {
    const flood = Array.from({ length: 201 }, () => app.inject({ method: "POST", url: "/webhooks/meta-hub", payload: "{}", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9" } }));
    const statuses = (await Promise.all(flood)).map(response => response.statusCode);
    expect(statuses).toContain(429);
    const envelope = envelopeOf();
    expect((await deliver(envelope, { headers: { "x-real-ip": "198.51.100.7" } })).statusCode).toBe(200);
  });

  it("falha ao gravar responde 503 para o hub reentregar", async () => {
    vi.spyOn(prisma.hubWebhookEvent, "createMany").mockRejectedValueOnce(new Error("conexão perdida"));
    const response = await deliver(envelopeOf());
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("WEBHOOK_PERSISTENCE_UNAVAILABLE");
  });

  it("workspace desconhecido ou com externalId de outra org fica unresolved", async () => {
    const unknown = envelopeOf({ workspace: { id: `ws_${randomUUID()}`, externalId: orgA } });
    const forged = envelopeOf({ workspace: { id: workspaceA, externalId: orgB } });
    for (const envelope of [unknown, forged]) {
      expect((await deliver(envelope)).statusCode).toBe(200);
      expect((await stored(envelope.id))[0]).toMatchObject({ status: "unresolved", organizationId: null, connectionId: null, lastErrorCode: "HUB_WORKSPACE_UNKNOWN" });
    }
  });

  it("workspace da org A com conexão da org B fica unresolved sem ligar a conexão", async () => {
    const envelope = envelopeOf({ connectionId: hubConnectionB });
    expect((await deliver(envelope)).statusCode).toBe(200);
    expect((await stored(envelope.id))[0]).toMatchObject({ status: "unresolved", organizationId: orgA, connectionId: null, lastErrorCode: "HUB_TENANT_MISMATCH" });
  });

  it("conexão da própria org é ligada na captura", async () => {
    const envelope = envelopeOf({ workspace: { id: workspaceB, externalId: orgB }, connectionId: hubConnectionB });
    await deliver(envelope);
    const connection = await prisma.channelConnection.findFirstOrThrow({ where: { hubConnectionId: hubConnectionB }, select: { id: true } });
    expect((await stored(envelope.id))[0]).toMatchObject({ status: "pending", organizationId: orgB, connectionId: connection.id });
  });

  it("JSON inválido e envelope incompleto são recusados sem gravar", async () => {
    expect((await deliver("{não é json")).statusCode).toBe(400);
    const incomplete = { id: `evt_${randomUUID()}`, type: "whatsapp.message.received" };
    expect((await deliver(incomplete)).statusCode).toBe(422);
    expect(await stored(incomplete.id)).toHaveLength(0);
  });

  // connection.* com whatsapp null: o handler processa sem criar linha, bom para exercitar o journal
  const connectionEvent = (workspace = { id: workspaceA, externalId: orgA }) => {
    const connectionId = `conn_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    return envelopeOf({ type: "connection.updated", workspace, connectionId, data: {
      id: connectionId, kind: "whatsapp", status: "disconnected", errorCode: null, workspaceId: workspace.id, whatsapp: null, createdAt, updatedAt: createdAt,
    } });
  };

  it("tipo sem handler nesta imagem continua pendente enquanto connection.* é processado", async () => {
    const message = envelopeOf();
    const connection = connectionEvent();
    await deliver(message);
    await deliver(connection);
    await dispatchDueEvents();
    expect((await stored(message.id))[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect((await stored(connection.id))[0]).toMatchObject({ status: "processed", attempts: 1, organizationId: orgA });
  });

  it("unresolved volta quando o workspace é ligado depois, sem gastar o orçamento de tentativas", async () => {
    const workspace = { id: `ws_${randomUUID()}`, externalId: orgA };
    const event = connectionEvent(workspace);
    await deliver(event);
    const [row] = await stored(event.id);
    expect(row.status).toBe("unresolved");
    await dispatchDueEvents();
    const [waiting] = await stored(event.id);
    expect(waiting).toMatchObject({ status: "unresolved", attempts: 0 });
    expect(waiting.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 240_000);
    const { orgId } = await signUpWithOrg(app, `hub-late-${randomUUID()}@eloscrm.test`, `hub-late-${randomUUID()}`);
    await prisma.organization.update({ where: { id: orgId }, data: { hubWorkspaceId: workspace.id } });
    // o externalId do envelope tem de ser a org dona do workspace
    await prisma.hubWebhookEvent.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(), payload: { ...(row.payload as object), workspace: { id: workspace.id, externalId: orgId } } } });
    await dispatchDueEvents();
    expect((await stored(event.id))[0]).toMatchObject({ status: "processed", organizationId: orgId });
  });

  it("lease vencida é retomada; lease viva não", async () => {
    const expired = connectionEvent();
    const live = connectionEvent();
    await deliver(expired);
    await deliver(live);
    await prisma.hubWebhookEvent.updateMany({ where: { hubEventId: expired.id }, data: { status: "processing", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000) } });
    await prisma.hubWebhookEvent.updateMany({ where: { hubEventId: live.id }, data: { status: "processing", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) } });
    await dispatchDueEvents();
    expect((await stored(expired.id))[0].status).toBe("processed");
    expect((await stored(live.id))[0].status).toBe("processing");
  });
});
