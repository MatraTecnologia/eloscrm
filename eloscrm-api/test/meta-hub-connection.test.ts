import { createHmac, randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.HUB_ENABLED = "true"; });

import type { FastifyInstance } from "fastify";
import { env } from "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import { WEBHOOK_ACTOR } from "../src/lib/actor.js";
import { applyHubConnection } from "../src/modules/meta-hub/connection.service.js";
import { refreshWorkspaceConnections } from "../src/modules/meta-hub/hub-connect.service.js";
import { dispatchDueEvents } from "../src/modules/meta-hub/webhook.service.js";
import { refreshSyncProgress } from "../src/modules/whatsapp-onboarding/sync-request.service.js";
import * as syncRepo from "../src/modules/whatsapp-onboarding/sync-request.repo.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let otherOrgId: string;
const workspaceId = `ws_${randomUUID()}`;
const otherWorkspaceId = `ws_${randomUUID()}`;

beforeAll(async () => {
  app = await makeApp();
  ({ orgId, cookie } = await signUpWithOrg(app, `hubc-${randomUUID()}@eloscrm.test`, `hubc-${randomUUID()}`));
  ({ orgId: otherOrgId } = await signUpWithOrg(app, `hubc-o-${randomUUID()}@eloscrm.test`, `hubc-o-${randomUUID()}`));
  await prisma.organization.update({ where: { id: orgId }, data: { hubWorkspaceId: workspaceId } });
  await prisma.organization.update({ where: { id: otherOrgId }, data: { hubWorkspaceId: otherWorkspaceId } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const digits = () => String(randomInt(1, 1_000_000_000));
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 12, 12, minutes)).toISOString();
type Overrides = Record<string, unknown> & { whatsapp?: Record<string, unknown> | null };
const hubConnection = (overrides: Overrides = {}) => {
  const { whatsapp, ...rest } = overrides;
  return {
    id: `conn_${randomUUID()}`, kind: "whatsapp", status: "pending", errorCode: null, workspaceId,
    whatsapp: whatsapp === null ? null : {
      wabaId: digits(), businessId: digits(), phoneNumberId: digits(), displayPhoneNumber: "+55 43 99999-0000",
      verifiedName: "Imobiliária Teste", isOnBizApp: true, qualityRating: "GREEN", currency: "BRL", timezone: "America/Sao_Paulo", ...whatsapp,
    },
    facebookPage: null, sync: [], tokenExpiresAt: null, health: null, createdAt: at(0), updatedAt: at(0), ...rest,
  };
};
const apply = (data: unknown, meta: unknown = null, org = orgId) => applyHubConnection(org, data, { meta, actor: WEBHOOK_ACTOR });
const row = (hubConnectionId: string) => prisma.channelConnection.findFirst({ where: { hubConnectionId } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("applyHubConnection", () => {
  it("segue created → active → error(token_expired) → disconnected e grava o portfólio na criação", async () => {
    const base = hubConnection();
    expect(await apply(base)).toMatchObject({ status: "processed" });
    let current = await row(base.id);
    expect(current).toMatchObject({ status: "pending", organizationId: orgId, provider: "cloud_api", businessPortfolioId: base.whatsapp!.businessId, wabaId: base.whatsapp!.wabaId, tokenEnc: null });
    await apply({ ...base, status: "active", tokenExpiresAt: "2027-01-01T00:00:00.000Z", updatedAt: at(1) });
    current = await row(base.id);
    expect(current).toMatchObject({ status: "connected", hubErrorCode: null });
    expect(current!.tokenExpiresAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    await apply({ ...base, status: "error", errorCode: "token_expired", tokenExpiresAt: null, updatedAt: at(2) });
    current = await row(base.id);
    // null em error é credencial apagada, não "sem prazo"
    expect(current).toMatchObject({ status: "disconnected", hubErrorCode: "token_expired" });
    expect(current!.tokenExpiresAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    await apply({ ...base, status: "disconnected", updatedAt: at(3) }, { reason: "meta_uninstalled", accountEvent: "PARTNER_REMOVED" });
    expect(await row(base.id)).toMatchObject({ status: "disconnected", hubErrorCode: "meta_uninstalled" });
  });

  it("disconnected guarda o aviso de cada motivo; o nosso DELETE não gera aviso", async () => {
    const cases: [unknown, string | null][] = [
      [{ reason: "api" }, null],
      [{ reason: "meta_uninstalled", accountEvent: "PARTNER_APP_UNINSTALLED" }, "meta_uninstalled"],
      [{ reason: "meta_uninstalled", accountEvent: "PARTNER_REMOVED" }, "meta_uninstalled"],
      [{ reason: "meta_account_deleted", accountEvent: "ACCOUNT_DELETED" }, "meta_account_deleted"],
    ];
    for (const [meta, code] of cases) {
      const base = hubConnection({ status: "active" });
      await apply(base);
      await apply({ ...base, status: "disconnected", updatedAt: at(5) }, meta);
      expect(await row(base.id)).toMatchObject({ status: "disconnected", hubErrorCode: code });
    }
  });

  it("evento velho não regride e o mesmo updatedAt reaplicado não muda nada", async () => {
    const base = hubConnection({ status: "active", updatedAt: at(10) });
    await apply(base);
    // o GET já deixou active; o connection.created (pending) atrasado tem updatedAt menor
    await apply({ ...base, status: "pending", updatedAt: at(0) });
    const after = await row(base.id);
    expect(after!.status).toBe("connected");
    await apply(base);
    const again = await row(base.id);
    expect({ ...again, updatedAt: null }).toEqual({ ...after, updatedAt: null });
  });

  it("status desconhecido não vira connected e fica processado com alerta", async () => {
    const base = hubConnection();
    await apply(base);
    expect(await apply({ ...base, status: "suspended", updatedAt: at(1) })).toMatchObject({ status: "processed", code: "HUB_STATUS_UNKNOWN" });
    expect((await row(base.id))!.status).toBe("pending");
  });

  it("lead_ads e kind desconhecido não criam linha", async () => {
    for (const kind of ["lead_ads", "instagram"]) {
      const base = hubConnection({ kind, whatsapp: null });
      expect(await apply(base)).toMatchObject({ status: "unsupported" });
      expect(await row(base.id)).toBeNull();
    }
  });

  it("whatsapp null: id desconhecido não cria linha, id ligado mantém os campos locais", async () => {
    const orphan = hubConnection({ status: "disconnected", whatsapp: null });
    expect(await apply(orphan)).toMatchObject({ status: "processed" });
    expect(await row(orphan.id)).toBeNull();
    const base = hubConnection({ status: "active" });
    await apply(base);
    const before = await row(base.id);
    await apply({ ...base, status: "disconnected", whatsapp: null, updatedAt: at(4) }, { reason: "meta_uninstalled" });
    expect(await row(base.id)).toMatchObject({ status: "disconnected", phoneNumberId: before!.phoneNumberId, wabaId: before!.wabaId, displayPhoneNumber: before!.displayPhoneNumber, currency: "BRL" });
  });

  it("reconexão por connection.updated com id desconhecido casa a linha disabled da org, inclusive com hubConnectionId antigo", async () => {
    const fixture = await createOfficialConnectionFixture(orgId);
    const oldHubId = `conn_${randomUUID()}`;
    await prisma.channelConnection.update({ where: { id: fixture.connection.id }, data: { status: "disabled", disabledAt: new Date(), hubConnectionId: oldHubId } });
    await prisma.officialSyncRequest.create({ data: { organizationId: orgId, connectionId: fixture.connection.id, syncType: "history", status: "failed", deadlineAt: new Date() } });
    const base = hubConnection({
      status: "pending",
      whatsapp: { wabaId: fixture.input.wabaId, phoneNumberId: fixture.input.phoneNumberId, businessId: fixture.input.businessPortfolioId },
      sync: [{ type: "history", status: "accepted", progress: 40, errorCode: null }],
    });
    expect(await apply(base)).toMatchObject({ status: "processed", connectionId: fixture.connection.id });
    expect(await prisma.channelConnection.findUnique({ where: { id: fixture.connection.id } })).toMatchObject({ hubConnectionId: base.id, status: "pending", disabledAt: null, tokenEnc: null });
    // a ligação regrava o failed que o disable deixou
    expect(await prisma.officialSyncRequest.findFirst({ where: { connectionId: fixture.connection.id, syncType: "history" } })).toMatchObject({ status: "accepted", progress: 40 });
    expect(await prisma.channelConnection.count({ where: { phoneNumberId: fixture.input.phoneNumberId } })).toBe(1);
  });

  const disableLinked = async (hubConnectionId: string) => {
    const linked = await row(hubConnectionId);
    await prisma.officialSyncRequest.updateMany({ where: { connectionId: linked!.id }, data: { status: "failed", lastErrorCode: "OFFICIAL_CONNECTION_DISABLED" } });
    await prisma.channelConnection.update({ where: { id: linked!.id }, data: { status: "disabled", disabledAt: new Date(at(30)) } });
  };
  const accepted = [{ type: "history", status: "accepted", progress: 10, errorCode: null }];

  it("disabled ligada não volta com snapshot reaplicado nem com active solto, e a reconexão por pending regrava o sync", async () => {
    const base = hubConnection({ status: "active", sync: accepted });
    await apply(base);
    await disableLinked(base.id);
    // mesmo snapshot (retry do journal, voltar do navegador) e aviso de health depois do disable
    expect(await apply(base)).toMatchObject({ status: "failed", code: "HUB_CONNECTION_DISABLED" });
    await apply({ ...base, updatedAt: at(31), health: { status: "LIMITED" } });
    expect((await row(base.id))!.status).toBe("disabled");
    await apply({ ...base, status: "pending", updatedAt: at(32) });
    const current = await row(base.id);
    expect(current).toMatchObject({ status: "pending", disabledAt: null });
    expect(await prisma.officialSyncRequest.findFirst({ where: { connectionId: current!.id } })).toMatchObject({ status: "accepted", lastErrorCode: null });
  });

  it("reconexão com o active antes do pending termina connected pela retentativa do active", async () => {
    const base = hubConnection({ status: "active" });
    await apply(base);
    await disableLinked(base.id);
    const active = { ...base, updatedAt: at(33) };
    expect(await apply(active)).toMatchObject({ status: "failed", code: "HUB_CONNECTION_DISABLED" });
    expect((await row(base.id))!.hubUpdatedAt?.toISOString()).toBe(at(0));
    await apply({ ...base, status: "pending", updatedAt: at(32) });
    expect(await apply(active)).toMatchObject({ status: "processed" });
    expect((await row(base.id))!.status).toBe("connected");
  });

  it("o GET do retorno do navegador com active já tira do disable", async () => {
    const base = hubConnection({ status: "active", sync: accepted });
    await apply(base);
    await disableLinked(base.id);
    await applyHubConnection(orgId, { ...base, updatedAt: at(34) }, { fromGet: true, fromReturn: true, actor: WEBHOOK_ACTOR });
    expect(await row(base.id)).toMatchObject({ status: "connected", disabledAt: null });
  });

  it("número de outra org, pelo phoneNumberId ou pelo wabaId, dá WHATSAPP_NUMBER_UNAVAILABLE e DELETE no hub, nunca P2002", async () => {
    const foreign = await createOfficialConnectionFixture(otherOrgId);
    await prisma.channelConnection.update({ where: { id: foreign.connection.id }, data: { status: "disabled", disabledAt: new Date() } });
    for (const whatsapp of [{ phoneNumberId: foreign.input.phoneNumberId }, { wabaId: foreign.input.wabaId }]) {
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ connection: {} }));
      const base = hubConnection({ whatsapp });
      expect(await apply(base)).toMatchObject({ status: "failed", code: "WHATSAPP_NUMBER_UNAVAILABLE" });
      expect(await row(base.id)).toBeNull();
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1]?.method).toBe("DELETE");
      expect(String(fetch.mock.calls[0][0])).toContain(`/connections/${base.id}`);
      vi.restoreAllMocks();
    }
  });

  it("mesma org com wabaId ou portfólio diferente dá WHATSAPP_ASSET_CHANGED sem DELETE", async () => {
    const fixture = await createOfficialConnectionFixture(orgId);
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const whatsapp of [{ phoneNumberId: fixture.input.phoneNumberId, wabaId: digits(), businessId: fixture.input.businessPortfolioId }, { phoneNumberId: fixture.input.phoneNumberId, wabaId: fixture.input.wabaId, businessId: digits() }]) {
      const base = hubConnection({ whatsapp });
      expect(await apply(base)).toMatchObject({ status: "failed", code: "WHATSAPP_ASSET_CHANGED" });
      expect(await row(base.id)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("número inédito cria linha nova", async () => {
    const base = hubConnection();
    const outcome = await apply(base);
    expect(outcome.connectionId).toBeTruthy();
    expect(await prisma.channelConnection.count({ where: { hubConnectionId: base.id } })).toBe(1);
  });

  it("sync[] terminal não regride", async () => {
    const base = hubConnection({ status: "active", sync: [{ type: "history", status: "completed", progress: 100, errorCode: null }, { type: "smb_app_state_sync", status: "requested", progress: null, errorCode: null }] });
    const { connectionId } = await apply(base);
    await apply({ ...base, updatedAt: at(1), sync: [{ type: "history", status: "accepted", progress: 40, errorCode: null }, { type: "smb_app_state_sync", status: "failed", progress: null, errorCode: "declined_by_business" }] });
    const syncs = await prisma.officialSyncRequest.findMany({ where: { connectionId }, orderBy: { syncType: "asc" } });
    expect(syncs.map(item => [item.syncType, item.status, item.progress])).toEqual([["history", "complete", 100], ["smb_app_state_sync", "declined", 0]]);
  });

  it("o job antigo de sync não lê nem escreve as linhas de uma conexão do hub", async () => {
    // linha accepted e evento antigo com progresso 100: sem o filtro, refreshSyncProgress a levaria a complete
    const base = hubConnection({ status: "pending", sync: accepted });
    const { connectionId } = await apply(base);
    await prisma.channelConnection.update({ where: { id: connectionId }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    await prisma.officialSyncRequest.updateMany({ where: { connectionId }, data: { status: "pending", deadlineAt: new Date(Date.now() + 3_600_000) } });
    const accepting = hubConnection();
    const { connectionId: acceptingId } = await apply({ ...accepting, sync: accepted });
    const [request] = await prisma.officialSyncRequest.findMany({ where: { connectionId: acceptingId } });
    await prisma.officialWebhookEvent.create({ data: {
      dedupKey: randomUUID(), wabaId: accepting.whatsapp!.wabaId, field: "history", payload: {}, organizationId: orgId, connectionId: acceptingId,
      status: "processed", receivedAt: new Date(request.createdAt.getTime() + 1000), nextAttemptAt: new Date(), syncDetails: [{ progress: 100 }],
    } });
    expect((await syncRepo.dueConnections()).map(item => item.id)).not.toContain(connectionId);
    expect((await syncRepo.activeSyncConnections()).map(item => item.connectionId)).not.toContain(acceptingId);
    await refreshSyncProgress(orgId, acceptingId!);
    expect(await prisma.officialSyncRequest.findFirst({ where: { connectionId: acceptingId } })).toMatchObject({ status: "accepted", progress: 10 });
  });

  it("currency e timezone nulos no hub não apagam o valor local", async () => {
    const base = hubConnection({ status: "active" });
    await apply(base);
    await apply({ ...base, updatedAt: at(1), whatsapp: { ...base.whatsapp, currency: null, timezone: null } });
    expect(await row(base.id)).toMatchObject({ currency: "BRL", timezone: "America/Sao_Paulo" });
  });

  it("varredura do workspace ignora lead_ads e aplica as de WhatsApp", async () => {
    const whatsapp = hubConnection({ status: "active" });
    const leads = hubConnection({ kind: "lead_ads", whatsapp: null });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ data: [whatsapp, leads], meta: { total: 2, page: 1, limit: 100, totalPages: 1, hasNext: false } }));
    await refreshWorkspaceConnections(orgId, workspaceId);
    expect((await row(whatsapp.id))!.status).toBe("connected");
    expect(await row(leads.id)).toBeNull();
  });
});

describe("eventos connection.* pelo journal", () => {
  const deliver = (body: unknown) => {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return app.inject({ method: "POST", url: "/webhooks/meta-hub", payload: raw, headers: {
      "content-type": "application/json", "x-hub-timestamp": timestamp,
      "x-hub-signature": `sha256=${createHmac("sha256", env.HUB_WEBHOOK_SECRET!).update(`${timestamp}.${raw}`).digest("hex")}`,
    } });
  };
  const envelope = (type: string, data: ReturnType<typeof hubConnection>, meta: unknown = null) => ({
    id: `evt_${randomUUID()}`, type, createdAt: data.updatedAt, workspace: { id: workspaceId, externalId: orgId }, connectionId: data.id, data, meta,
  });

  it("created e updated fora de ordem terminam active e o journal fica processed", async () => {
    const base = hubConnection();
    const updated = envelope("connection.updated", { ...base, status: "active", updatedAt: at(1) });
    const created = envelope("connection.created", base);
    expect((await deliver(updated)).statusCode).toBe(200);
    expect((await deliver(created)).statusCode).toBe(200);
    await dispatchDueEvents();
    expect((await row(base.id))!.status).toBe("connected");
    const events = await prisma.hubWebhookEvent.findMany({ where: { hubEventId: { in: [updated.id, created.id] } } });
    expect(events.map(event => event.status)).toEqual(["processed", "processed"]);
  });

  it("data de outra conexão que não a do envelope falha sem aplicar", async () => {
    const base = hubConnection();
    const forged = { ...envelope("connection.created", base), connectionId: `conn_${randomUUID()}` };
    await deliver(forged);
    await dispatchDueEvents();
    expect(await row(base.id)).toBeNull();
    expect((await prisma.hubWebhookEvent.findFirstOrThrow({ where: { hubEventId: forged.id } })).lastErrorCode).toBe("HUB_CONNECTION_MISMATCH");
  });
});

describe("rotas /v1/whatsapp/hub", () => {
  const origin = new URL(env.WEB_ORIGIN).origin;
  const post = (url: string, body: unknown = {}) => app.inject({ method: "POST", url, payload: body as object, headers: { cookie, origin } });

  it("abre a sessão só com os três campos e returnUrl sem query", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ id: "cs_1", url: "https://hub.test/connect#s=cs_x", expiresAt: at(15) }, 201));
    const response = await post("/v1/whatsapp/hub/connect-sessions");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ url: "https://hub.test/connect#s=cs_x", expiresAt: at(15) });
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toEqual({ kind: "whatsapp", returnUrl: `${origin}/integracoes/whatsapp`, requireCoexistence: true });
    expect(new URL(body.returnUrl).search).toBe("");
    expect(String(fetch.mock.calls[0][0])).toContain(`/workspaces/${workspaceId}/connect-sessions`);
  });

  it("recusa corpo com campo extra e Origin de fora", async () => {
    expect((await post("/v1/whatsapp/hub/connect-sessions", { kind: "lead_ads" })).statusCode).toBe(422);
    const response = await app.inject({ method: "POST", url: "/v1/whatsapp/hub/connect-sessions", payload: {}, headers: { cookie, origin: "https://evil.test" } });
    expect(response.statusCode).toBe(403);
  });

  it("refresh com conexão de outro workspace ou lead_ads responde 404; a própria devolve só o select público", async () => {
    const other = hubConnection({ workspaceId: otherWorkspaceId });
    const leads = hubConnection({ kind: "lead_ads", whatsapp: null });
    const own = hubConnection({ status: "active" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      const found = [other, leads, own].find(item => url.endsWith(`/connections/${item.id}`));
      return found ? json({ connection: found }) : json({ code: "CONNECTION_NOT_FOUND" }, 404);
    });
    for (const item of [other, leads]) expect((await post(`/v1/whatsapp/hub/connections/${item.id}/refresh`)).statusCode).toBe(404);
    expect((await post(`/v1/whatsapp/hub/connections/conn_${randomUUID()}/refresh`)).statusCode).toBe(404);
    expect(await row(other.id)).toBeNull();
    const response = await post(`/v1/whatsapp/hub/connections/${own.id}/refresh`);
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result).toMatchObject({ status: "connected", hubConnectionId: own.id, organizationId: orgId });
    expect(result).not.toHaveProperty("tokenEnc");
    expect((await row(own.id))!.hubCheckedAt).toBeTruthy();
  });

  it("config diz se a conexão pelo hub está disponível", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/whatsapp/hub/config", headers: { cookie } });
    expect(response.json()).toEqual({ available: true });
  });
});
