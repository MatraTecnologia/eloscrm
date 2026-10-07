import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.META_WHATSAPP_APP_ID = "123456";
  process.env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = "654321";
});
vi.mock("../src/lib/whatsapp-official/graph.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/lib/whatsapp-official/graph.js")>();
  return { ...actual, exchangeCode: vi.fn(), inspectToken: vi.fn(), readWaba: vi.fn(), readPhones: vi.fn(), readAppSubscriptions: vi.fn(), subscribeWaba: vi.fn(), requestSync: vi.fn() };
});

import * as graph from "../src/lib/whatsapp-official/graph.js";
import { env } from "../src/env.js";
import { prisma } from "../src/lib/prisma.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import * as service from "../src/modules/whatsapp-onboarding/onboarding.service.js";
import * as syncService from "../src/modules/whatsapp-onboarding/sync-request.service.js";
import * as repo from "../src/modules/whatsapp-onboarding/onboarding.repo.js";
import { processEvent } from "../src/modules/whatsapp-official/webhook.service.js";
import { capture } from "../src/modules/whatsapp-official/webhook.repo.js";

let app: FastifyInstance;
let orgA: string;
let orgB: string;
let cookieA: string;
let cookieB: string;
let scopeA: repo.OnboardingScope;
let wabaId: string;
let phoneId: string;
let token: string;
const stamp = `${process.pid}-${Date.now()}`;
let sequence = 0;
const code = () => randomBytes(24).toString("base64url");
const headers = () => ({ cookie: cookieA, origin: env.WEB_ORIGIN });
const phone = (id = phoneId) => ({ id, display_phone_number: "+55 11 0000-0000", verified_name: "Imobiliária fictícia", is_on_biz_app: true, platform_type: "CLOUD_API" });

beforeAll(async () => {
  app = await makeApp();
  ({ orgId: orgA, cookie: cookieA } = await signUpWithOrg(app, `onboarding-a-${stamp}@eloscrm.test`, `onboarding-a-${stamp}`));
  ({ orgId: orgB, cookie: cookieB } = await signUpWithOrg(app, `onboarding-b-${stamp}@eloscrm.test`, `onboarding-b-${stamp}`));
  const session = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie: cookieA } });
  scopeA = { orgId: orgA, userId: session.json().user.id, sessionId: session.json().session.id };
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => {
  vi.resetAllMocks();
  wabaId = `${Date.now()}${sequence++}1`;
  phoneId = `${Date.now()}${sequence++}2`;
  token = randomBytes(24).toString("base64url");
  vi.mocked(graph.readAppSubscriptions).mockResolvedValue({ data: [{ object: "whatsapp_business_account", active: true, callback_url: `${env.PUBLIC_API_URL}/webhooks/whatsapp-official`, fields: ["messages", "history", "smb_app_state_sync", "smb_message_echoes"].map(name => ({ name })) }] });
  vi.mocked(graph.exchangeCode).mockResolvedValue({ access_token: token });
  vi.mocked(graph.inspectToken).mockResolvedValue({ data: { app_id: env.META_WHATSAPP_APP_ID, is_valid: true, expires_at: 0, scopes: ["whatsapp_business_management", "whatsapp_business_messaging"], granular_scopes: ["whatsapp_business_management", "whatsapp_business_messaging"].map(scope => ({ scope, target_ids: [wabaId] })) } });
  vi.mocked(graph.readWaba).mockResolvedValue({ id: wabaId, owner_business_info: { id: `${wabaId}9` }, currency: "BRL", timezone_id: "25" });
  vi.mocked(graph.readPhones).mockImplementation(async () => [{ data: [phone()] }]);
  vi.mocked(graph.subscribeWaba).mockResolvedValue({ success: true });
  vi.mocked(graph.requestSync).mockImplementation(async (_token, _id, type) => ({ request_id: `request-${type}` }));
});
const verifiedAttempt = async () => {
  const attempt = await service.start(scopeA);
  await service.exchange(scopeA, attempt.id, { code: code(), wabaId });
  return attempt;
};
const activated = async () => {
  const attempt = await verifiedAttempt();
  const result = await service.activate(scopeA, attempt.id, phoneId, { id: scopeA.userId, name: "Gestor fictício" });
  return { ...result, attempt };
};

describe("onboarding oficial em Coexistence", () => {
  it("exige sessão e origem exata; rejeita campos extras sem expor código", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/onboarding", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/onboarding", headers: { ...headers(), origin: "https://evil-facebook.com" }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/onboarding", headers: headers(), payload: { organizationId: orgB } })).statusCode).toBe(422);
    const attempt = await service.start(scopeA);
    const secret = code();
    const response = await app.inject({ method: "POST", url: `/v1/whatsapp/onboarding/${attempt.id}/exchange`, headers: headers(), payload: { code: secret, wabaId, token: secret } });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain(secret);
    expect(graph.exchangeCode).not.toHaveBeenCalled();
  });

  it("vincula a tentativa à imobiliária, usuário e sessão", async () => {
    const attempt = await service.start(scopeA);
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/onboarding/${attempt.id}`, headers: { cookie: cookieB } })).statusCode).toBe(404);
    await expect(service.get({ ...scopeA, sessionId: "outra-sessao" }, attempt.id)).rejects.toMatchObject({ statusCode: 404 });
    await prisma.member.updateMany({ where: { organizationId: orgA, userId: scopeA.userId }, data: { role: "member" } });
    try { await expect(service.configuration(scopeA)).rejects.toMatchObject({ statusCode: 403 }); }
    finally { await prisma.member.updateMany({ where: { organizationId: orgA, userId: scopeA.userId }, data: { role: "owner" } }); }
  });

  it("confere callback e assinaturas antes de abrir cadastro", async () => {
    vi.mocked(graph.readAppSubscriptions).mockResolvedValue({ data: [{ object: "whatsapp_business_account", callback_url: "https://wrong.eloscrm.test/webhooks/whatsapp-official", fields: [] }] });
    await expect(service.start(scopeA)).rejects.toMatchObject({ code: "OFFICIAL_WEBHOOK_NOT_READY" });
    expect(graph.exchangeCode).not.toHaveBeenCalled();
  });

  it("abre cadastro sem exigir user_id_update indisponível no app", async () => {
    const attempt = await service.start(scopeA);
    expect(attempt.status).toBe("pending");
    expect(graph.exchangeCode).not.toHaveBeenCalled();
  });

  it.each(["messages", "history", "smb_app_state_sync", "smb_message_echoes"])("recusa cadastro sem a assinatura obrigatória %s", async missing => {
    vi.mocked(graph.readAppSubscriptions).mockResolvedValue({ data: [{ object: "whatsapp_business_account", active: true, callback_url: `${env.PUBLIC_API_URL}/webhooks/whatsapp-official`, fields: ["messages", "history", "smb_app_state_sync", "smb_message_echoes", "user_id_update"].filter(name => name !== missing).map(name => ({ name })) }] });
    await expect(service.start(scopeA)).rejects.toMatchObject({ code: "OFFICIAL_WEBHOOK_NOT_READY" });
    expect(graph.exchangeCode).not.toHaveBeenCalled();
  });

  it("recusa assinatura desativada mesmo com os eventos e callback corretos", async () => {
    vi.mocked(graph.readAppSubscriptions).mockResolvedValue({ data: [{ object: "whatsapp_business_account", active: false, callback_url: `${env.PUBLIC_API_URL}/webhooks/whatsapp-official`, fields: ["messages", "history", "smb_app_state_sync", "smb_message_echoes"].map(name => ({ name })) }] });
    await expect(service.start(scopeA)).rejects.toMatchObject({ code: "OFFICIAL_WEBHOOK_NOT_READY" });
  });

  it("descobre portfolio e números no servidor, cifra token e não o retorna", async () => {
    const attempt = await verifiedAttempt();
    const response = await app.inject({ method: "GET", url: `/v1/whatsapp/onboarding/${attempt.id}`, headers: headers() });
    expect(response.json().candidates).toEqual([{ id: phoneId, displayPhoneNumber: phone().display_phone_number, verifiedName: phone().verified_name }]);
    expect(response.body).not.toContain(token);
    const stored = await repo.find(scopeA, attempt.id);
    expect(stored?.businessPortfolioId).toBe(`${wabaId}9`);
    expect(stored?.tokenEnc).not.toBe(token);
    expect(stored?.tokenEnc).toBeTruthy();
  });

  it.each(["app", "grant", "expired"])("recusa autorização inválida: %s", async reason => {
    const attempt = await service.start(scopeA);
    const original = await graph.inspectToken(token) as { data: Record<string, unknown> };
    vi.mocked(graph.inspectToken).mockResolvedValue({ data: { ...original.data,
      ...(reason === "app" ? { app_id: "999" } : reason === "expired" ? { expires_at: 1 } : { granular_scopes: [] }),
    } });
    await expect(service.exchange(scopeA, attempt.id, { code: code(), wabaId })).rejects.toMatchObject({ code: "OFFICIAL_GRANT_INVALID" });
    expect((await repo.find(scopeA, attempt.id))?.status).toBe("failed");
    expect(graph.subscribeWaba).not.toHaveBeenCalled();
  });

  it("recusa número Cloud API sem Business App", async () => {
    vi.mocked(graph.readPhones).mockResolvedValue([{ data: [{ ...phone(), is_on_biz_app: false }] }]);
    const attempt = await service.start(scopeA);
    await expect(service.exchange(scopeA, attempt.id, { code: code(), wabaId })).rejects.toMatchObject({ code: "OFFICIAL_COEX_REQUIRED" });
  });

  it("troca o código uma vez sob concorrência e responde replay sem nova troca", async () => {
    const attempt = await service.start(scopeA);
    const input = { code: code(), wabaId };
    const results = await Promise.allSettled([service.exchange(scopeA, attempt.id, input), service.exchange(scopeA, attempt.id, input)]);
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    for (const result of results) {
      if (result.status === "fulfilled") expect(result.value.status).toBe("verified");
      else expect(result.reason).toMatchObject({ code: "OFFICIAL_ATTEMPT_UNAVAILABLE" });
    }
    expect(graph.exchangeCode).toHaveBeenCalledTimes(1);
    await service.exchange(scopeA, attempt.id, input);
    expect(graph.exchangeCode).toHaveBeenCalledTimes(1);
    const next = await service.start(scopeA);
    await expect(service.exchange(scopeA, next.id, input)).rejects.toMatchObject({ code: "OFFICIAL_CODE_REUSED" });
  });

  it("não troca novamente código com timeout ou tentativa expirada", async () => {
    const attempt = await service.start(scopeA);
    vi.mocked(graph.exchangeCode).mockRejectedValue(new graph.OfficialGraphError(null, true));
    const input = { code: code(), wabaId };
    await expect(service.exchange(scopeA, attempt.id, input)).rejects.toMatchObject({ code: "OFFICIAL_EXCHANGE_UNCERTAIN" });
    await expect(service.exchange(scopeA, attempt.id, input)).rejects.toMatchObject({ code: "OFFICIAL_ATTEMPT_UNAVAILABLE" });
    expect(graph.exchangeCode).toHaveBeenCalledTimes(1);
    const expired = await service.start(scopeA);
    await repo.update(scopeA, expired.id, { expiresAt: new Date(0) });
    await expect(service.exchange(scopeA, expired.id, { code: code(), wabaId })).rejects.toMatchObject({ code: "OFFICIAL_ATTEMPT_UNAVAILABLE" });
  });

  it.each([
    ["exchangeCode", "OFFICIAL_CODE_EXCHANGE_FAILED"],
    ["inspectToken", "OFFICIAL_TOKEN_INSPECTION_FAILED"],
    ["readWaba", "OFFICIAL_WABA_READ_FAILED"],
    ["readPhones", "OFFICIAL_PHONES_READ_FAILED"],
  ] as const)("identifica falha em %s sem expor a autorização", async (operation, expectedCode) => {
    const attempt = await service.start(scopeA);
    vi.mocked(graph[operation]).mockRejectedValue(new graph.OfficialGraphError(100, false));
    const input = { code: code(), wabaId };
    const error = await service.exchange(scopeA, attempt.id, input).catch(error => error);
    expect(error).toMatchObject({ statusCode: 502, code: expectedCode });
    expect(error.message).toContain("código Meta 100");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain(input.code);
    expect(await repo.find(scopeA, attempt.id)).toMatchObject({ status: "failed", lastErrorCode: expectedCode, tokenEnc: null });
    await expect(service.exchange(scopeA, attempt.id, input)).rejects.toMatchObject({ code: "OFFICIAL_ATTEMPT_UNAVAILABLE" });
    expect(graph.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("identifica resposta de conta inválida sem expor dados retornados pela Meta", async () => {
    const attempt = await service.start(scopeA);
    vi.mocked(graph.readWaba).mockResolvedValue({ id: wabaId, owner_business_info: null });
    const error = await service.exchange(scopeA, attempt.id, { code: code(), wabaId }).catch(error => error);
    expect(error).toMatchObject({ code: "OFFICIAL_WABA_READ_FAILED" });
    expect(error.message).toContain("resposta em formato inesperado");
    expect(error.message).toContain("owner_business_info");
    expect(error.message).not.toContain(wabaId);
    expect(error.message).not.toContain(token);
  });

  it.each(["omitted", "null"])("valida conta sem moeda e fuso quando os metadados estão %s", async mode => {
    const attempt = await service.start(scopeA);
    vi.mocked(graph.readWaba).mockResolvedValue({ id: wabaId, owner_business_info: { id: `${wabaId}9` }, ...(mode === "null" ? { currency: null, timezone_id: null } : {}) });
    const result = await service.exchange(scopeA, attempt.id, { code: code(), wabaId });
    expect(result.status).toBe("verified");
    expect(await repo.find(scopeA, attempt.id)).toMatchObject({ currency: null, timezoneId: null, businessPortfolioId: `${wabaId}9` });
    expect(result.candidates).toHaveLength(1);
  });

  it("não aceita moeda presente em formato inválido", async () => {
    const attempt = await service.start(scopeA);
    vi.mocked(graph.readWaba).mockResolvedValue({ id: wabaId, owner_business_info: { id: `${wabaId}9` }, currency: "invalid" });
    const error = await service.exchange(scopeA, attempt.id, { code: code(), wabaId }).catch(error => error);
    expect(error).toMatchObject({ code: "OFFICIAL_WABA_READ_FAILED" });
    expect(error.message).toContain("currency");
    expect(error.message).not.toContain("invalid");
  });

  it("permite escolher somente número remoto autorizado e rejeita revogação", async () => {
    const secondId = `${phoneId}3`;
    vi.mocked(graph.readPhones).mockResolvedValue([{ data: [phone(), phone(secondId)] }]);
    const attempt = await verifiedAttempt();
    expect((await service.get(scopeA, attempt.id)).candidates).toHaveLength(2);
    await expect(service.activate(scopeA, attempt.id, "123", { id: scopeA.userId, name: "Gestor" })).rejects.toMatchObject({ code: "OFFICIAL_PHONE_NOT_GRANTED" });
    vi.mocked(graph.readPhones).mockResolvedValue([{ data: [] }]);
    await expect(service.activate(scopeA, attempt.id, phoneId, { id: scopeA.userId, name: "Gestor" })).rejects.toMatchObject({ code: "OFFICIAL_PHONE_NOT_GRANTED" });
    expect(graph.subscribeWaba).not.toHaveBeenCalled();
  });

  it("conclui concorrente uma vez e persiste pedidos antes da chamada remota", async () => {
    const attempt = await verifiedAttempt();
    vi.mocked(graph.requestSync).mockImplementation(async (_token, id, type) => {
      const stored = await prisma.officialSyncRequest.findFirstOrThrow({ where: { organizationId: orgA, connection: { phoneNumberId: id }, syncType: type } });
      expect(stored.status).toBe("requesting");
      return { request_id: `request-${type}` };
    });
    const results = await Promise.all([service.activate(scopeA, attempt.id, phoneId, { id: scopeA.userId, name: "Gestor" }), service.activate(scopeA, attempt.id, phoneId, { id: scopeA.userId, name: "Gestor" })]);
    expect(results[0].connection.id).toBe(results[1].connection.id);
    expect(graph.requestSync).toHaveBeenCalledTimes(2);
    const syncs = await repo.listSyncs(orgA, results[0].connection.id);
    expect(syncs.every(sync => sync.status === "accepted" && sync.requestId)).toBe(true);
    expect((await repo.find(scopeA, attempt.id))?.tokenEnc).toBeNull();
    expect(await prisma.auditEvent.count({ where: { organizationId: orgA, action: "CONNECTED", context: { path: ["connectionId"], equals: results[0].connection.id } } })).toBe(1);
  });

  it("não vincula ativos usados em outra imobiliária nem assina WABA antes dessa checagem", async () => {
    const attempt = await verifiedAttempt();
    await prisma.channelConnection.create({ data: { organizationId: orgB, provider: "cloud_api", label: "Outro tenant", phoneNumberId: phoneId, wabaId } });
    await expect(service.activate(scopeA, attempt.id, phoneId, { id: scopeA.userId, name: "Gestor" })).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_UNAVAILABLE" });
    expect(graph.subscribeWaba).not.toHaveBeenCalled();
  });

  it("outro cadastro do mesmo número preserva requests aceitos ou incertos sem reenviar", async () => {
    const first = await activated();
    const history = first.syncs.find(sync => sync.syncType === "history")!;
    await prisma.officialSyncRequest.updateMany({ where: { id: history.id, organizationId: orgA }, data: { status: "uncertain", lastErrorCode: "OFFICIAL_SYNC_UNCERTAIN" } });
    const second = await activated();
    expect(second.connection.id).toBe(first.connection.id);
    expect(second.syncs.find(sync => sync.syncType === "history")).toMatchObject({ id: history.id, status: "uncertain", requestId: history.requestId });
    expect(graph.requestSync).toHaveBeenCalledTimes(2);
  });

  it("retoma assinatura após falha sem repetir pedidos aceitos", async () => {
    vi.mocked(graph.subscribeWaba).mockRejectedValueOnce(new graph.OfficialGraphError(null, true));
    const result = await activated();
    expect(result.connection.status).toBe("pending");
    expect(graph.requestSync).not.toHaveBeenCalled();
    await syncService.resumeConnection(orgA, result.connection.id);
    expect(graph.requestSync).toHaveBeenCalledTimes(2);
    await syncService.resumeConnection(orgA, result.connection.id);
    expect(graph.requestSync).toHaveBeenCalledTimes(2);
  });

  it("timeout de sync fica incerto e outro tipo continua, sem retry automático", async () => {
    vi.mocked(graph.requestSync).mockImplementation(async (_token, _id, type) => {
      if (type === "history") throw new graph.OfficialGraphError(null, true);
      return { request_id: "contacts-accepted" };
    });
    const result = await activated();
    expect(result.syncs.find(sync => sync.syncType === "history")?.status).toBe("uncertain");
    expect(result.syncs.find(sync => sync.syncType === "smb_app_state_sync")?.status).toBe("accepted");
    await syncService.resumeConnection(orgA, result.connection.id);
    expect(graph.requestSync).toHaveBeenCalledTimes(2);
  });

  it("marca crash durante request como incerto e bloqueia prazo vencido", async () => {
    const result = await activated();
    await prisma.officialSyncRequest.updateMany({ where: { organizationId: orgA, connectionId: result.connection.id }, data: { status: "requesting", requestedAt: new Date(0) } });
    await syncService.recoverOnboardings();
    expect((await repo.listSyncs(orgA, result.connection.id)).every(sync => sync.status === "uncertain")).toBe(true);
    await prisma.officialSyncRequest.updateMany({ where: { organizationId: orgA, connectionId: result.connection.id }, data: { status: "pending", deadlineAt: new Date(0) } });
    await syncService.recoverOnboardings();
    expect((await repo.listSyncs(orgA, result.connection.id)).every(sync => sync.status === "expired")).toBe(true);
    expect(graph.requestSync).toHaveBeenCalledTimes(2);
  });

  it("aceite não significa conclusão e journal com erro impede progresso 100% concluído", async () => {
    const result = await activated();
    await capture({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "history", value: { metadata: { phone_number_id: phoneId }, history: [{ metadata: { phase: 2, chunk_order: 0, progress: 100 }, threads: [] }] } }] }] }, new Date());
    const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { organizationId: orgA, connectionId: result.connection.id, field: "history" } });
    await processEvent(event.id);
    expect((await repo.listSyncs(orgA, result.connection.id)).find(sync => sync.syncType === "history")?.status).toBe("complete");
    await prisma.officialWebhookEvent.create({ data: { organizationId: orgA, connectionId: result.connection.id, wabaId, phoneNumberId: phoneId, field: "history", payload: {}, dedupKey: code(), status: "failed", receivedAt: new Date() } });
    await syncService.refreshSyncProgress(orgA, result.connection.id);
    const history = (await repo.listSyncs(orgA, result.connection.id)).find(sync => sync.syncType === "history");
    expect(history).toMatchObject({ status: "receiving", progress: 100, lastErrorCode: "OFFICIAL_SYNC_ITEMS_PENDING" });
  });

  it("registra recusa de histórico sem declarar agenda concluída", async () => {
    const result = await activated();
    await capture({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "history", value: { metadata: { phone_number_id: phoneId }, history: [{ errors: [{ code: 2593109 }] }] } }] }] }, new Date());
    const event = await prisma.officialWebhookEvent.findFirstOrThrow({ where: { organizationId: orgA, connectionId: result.connection.id, field: "history" } });
    await processEvent(event.id);
    expect((await repo.listSyncs(orgA, result.connection.id)).find(sync => sync.syncType === "history")?.status).toBe("declined");
    expect((await repo.listSyncs(orgA, result.connection.id)).find(sync => sync.syncType === "smb_app_state_sync")?.status).toBe("accepted");
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/connections/${result.connection.id}/sync`, headers: { cookie: cookieB } })).statusCode).toBe(404);
  });
});
