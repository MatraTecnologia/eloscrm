import { env } from "../../env.js";
import { conflict, forbidden, httpError, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import { decryptOfficialToken, encryptOfficialToken } from "../../lib/whatsapp-official/crypto.js";
import * as graph from "../../lib/whatsapp-official/graph.js";
import type { Actor } from "../../lib/actor.js";
import * as repo from "./onboarding.repo.js";
import * as schema from "./onboarding.schema.js";
import { resumeConnection } from "./sync-request.service.js";
import { get as getConnection } from "../channel-connections/channel-connections.service.js";

const requireManager = async (scope: repo.OnboardingScope) => { if (!await isOrgManager(scope.orgId, scope.userId)) throw forbidden("Somente gestores podem conectar o WhatsApp oficial"); };
export const configuration = async (scope: repo.OnboardingScope) => {
  await requireManager(scope);
  const ready = !!(env.META_WHATSAPP_APP_ID && env.META_WHATSAPP_APP_SECRET && env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID && env.META_WHATSAPP_TOKEN_ENCRYPTION_KEY && env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN && env.PUBLIC_API_URL);
  return ready ? { available: true as const, appId: env.META_WHATSAPP_APP_ID!, configId: env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID!, graphVersion: env.META_WHATSAPP_GRAPH_VERSION } : { available: false as const };
};
const publicAttempt = (attempt: NonNullable<Awaited<ReturnType<typeof repo.find>>>) => ({
  id: attempt.id, status: attempt.status, expiresAt: attempt.expiresAt, syncDeadlineAt: attempt.syncDeadlineAt,
  connectionId: attempt.connectionId, lastErrorCode: attempt.lastErrorCode,
  candidates: attempt.candidates ? schema.candidatesSchema.parse(attempt.candidates).map(phone => ({ id: phone.id, displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name ?? null })) : [],
});
const ownedAttempt = async (scope: repo.OnboardingScope, id: string) => {
  await requireManager(scope);
  const attempt = await repo.find(scope, id);
  if (!attempt) throw notFound("Cadastro não encontrado nesta sessão e imobiliária");
  return attempt;
};
export const start = async (scope: repo.OnboardingScope) => {
  if (!(await configuration(scope)).available) throw httpError(503, "OFFICIAL_ONBOARDING_NOT_CONFIGURED", "A conexão oficial não está habilitada neste ambiente");
  await checkSubscriptions();
  return publicAttempt(await repo.create(scope));
};
export const get = async (scope: repo.OnboardingScope, id: string) => publicAttempt(await ownedAttempt(scope, id));

const checkSubscriptions = async () => {
  const { data } = schema.subscriptionsSchema.parse(await graph.readAppSubscriptions());
  const required = ["messages", "history", "smb_app_state_sync", "smb_message_echoes"];
  const expected = `${env.PUBLIC_API_URL!.replace(/\/$/, "")}/webhooks/whatsapp-official`;
  if (!data.some(subscription => subscription.object === "whatsapp_business_account" && subscription.active !== false && subscription.callback_url?.replace(/\/$/, "") === expected && required.every(field => subscription.fields?.some(item => item.name === field)))) {
    throw conflict("OFFICIAL_WEBHOOK_NOT_READY", "Configure o webhook oficial e suas assinaturas antes de conectar o número");
  }
};

export const exchange = async (scope: repo.OnboardingScope, id: string, input: { code: string; wabaId: string }) => {
  const attempt = await ownedAttempt(scope, id);
  if (attempt.status !== "pending") {
    if (attempt.codeHash === repo.hash(input.code) && ["verified", "completed"].includes(attempt.status)) return publicAttempt(attempt);
    throw conflict("OFFICIAL_ATTEMPT_UNAVAILABLE", "Este cadastro já está em andamento ou terminou");
  }
  await checkSubscriptions();
  if (!await repo.claimExchange(scope, id, input.code)) throw conflict("OFFICIAL_ATTEMPT_UNAVAILABLE", "O cadastro expirou ou já está em andamento");
  let exchanged = false;
  let stage = "OFFICIAL_CODE_EXCHANGE_FAILED";
  let stageMessage = "A Meta recusou a troca do código de autorização";
  try {
    const token = schema.tokenSchema.parse(await graph.exchangeCode(input.code)).access_token;
    exchanged = true;
    stage = "OFFICIAL_TOKEN_INSPECTION_FAILED";
    stageMessage = "Não foi possível conferir as permissões do token na Meta";
    const { data: debug } = schema.debugSchema.parse(await graph.inspectToken(token));
    const required = ["whatsapp_business_management", "whatsapp_business_messaging"];
    const deadlines = [debug.expires_at, debug.data_access_expires_at ?? 0].filter(value => value > 0);
    if (!debug.is_valid || debug.app_id !== env.META_WHATSAPP_APP_ID || deadlines.some(value => value * 1000 <= Date.now()) || !required.every(permission => debug.scopes.includes(permission) && debug.granular_scopes.some(grant => grant.scope === permission && grant.target_ids?.includes(input.wabaId)))) {
      throw conflict("OFFICIAL_GRANT_INVALID", "A autorização não permite conectar esta conta WhatsApp ao app");
    }
    stage = "OFFICIAL_WABA_READ_FAILED";
    stageMessage = "Não foi possível consultar a conta WhatsApp autorizada";
    const parsedWaba = schema.wabaSchema.safeParse(await graph.readWaba(token, input.wabaId));
    if (!parsedWaba.success) {
      const fields = [...new Set(parsedWaba.error.issues.map(issue => issue.path.join(".")))].join(", ");
      throw httpError(502, "OFFICIAL_WABA_READ_FAILED", `A conta WhatsApp retornou uma resposta em formato inesperado. Campos ausentes ou inválidos: ${fields}. Inicie um novo cadastro.`);
    }
    const waba = parsedWaba.data;
    if (waba.id !== input.wabaId) throw conflict("OFFICIAL_ASSET_INVALID", "A conta WhatsApp não corresponde à autorização");
    stage = "OFFICIAL_PHONES_READ_FAILED";
    stageMessage = "Não foi possível consultar os números da conta WhatsApp";
    const phones = (await graph.readPhones(token, waba.id)).flatMap(page => schema.phonePageSchema.parse(page).data)
      .filter(phone => phone.is_on_biz_app && phone.platform_type === "CLOUD_API");
    if (!phones.length) throw conflict("OFFICIAL_COEX_REQUIRED", "Selecione um número existente no WhatsApp Business e conectado em Coexistence");
    stage = "OFFICIAL_ATTEMPT_SAVE_FAILED";
    stageMessage = "Não foi possível salvar a autorização no elosCRM";
    await repo.update(scope, id, {
      status: "verified", tokenEnc: encryptOfficialToken(token, { organizationId: scope.orgId, connectionId: id }),
      tokenExpiresAt: deadlines.length ? new Date(Math.min(...deadlines) * 1000) : null,
      wabaId: waba.id, businessPortfolioId: waba.owner_business_info.id, currency: waba.currency, timezoneId: waba.timezone_id,
      candidates: phones, lastErrorCode: null,
    });
    return publicAttempt((await repo.find(scope, id))!);
  } catch (error) {
    const uncertain = error instanceof graph.OfficialGraphError && error.uncertain && !exchanged;
    const code = error instanceof Error && "expose" in error && error.expose === true && "code" in error && typeof error.code === "string" ? error.code : uncertain ? "OFFICIAL_EXCHANGE_UNCERTAIN" : stage;
    await repo.update(scope, id, { status: uncertain ? "uncertain" : "failed", tokenEnc: null, lastErrorCode: code });
    if (error instanceof Error && "expose" in error && error.expose === true) throw error;
    const detail = error instanceof graph.OfficialGraphError && error.code !== null ? ` (código Meta ${error.code})` : error instanceof Error && error.name === "ZodError" ? " (resposta em formato inesperado)" : "";
    throw httpError(502, code, uncertain ? "O resultado da autorização ficou incerto; inicie um novo cadastro" : `${stageMessage}${detail}; inicie um novo cadastro.`);
  }
};

export const activate = async (scope: repo.OnboardingScope, id: string, phoneNumberId: string, actor: Actor) => {
  const attempt = await ownedAttempt(scope, id);
  if (attempt.status === "completed") return { connection: await getConnection(scope.orgId, attempt.connectionId!), syncs: await repo.listSyncs(scope.orgId, attempt.connectionId!) };
  if (attempt.status !== "verified" || !attempt.tokenEnc || attempt.expiresAt <= new Date()) throw conflict("OFFICIAL_ATTEMPT_UNAVAILABLE", "O cadastro expirou ou não está pronto para concluir");
  if (attempt.tokenExpiresAt && attempt.tokenExpiresAt <= new Date()) throw conflict("OFFICIAL_TOKEN_EXPIRED", "A autorização expirou; conecte novamente");
  if (!schema.candidatesSchema.parse(attempt.candidates).some(phone => phone.id === phoneNumberId)) throw conflict("OFFICIAL_PHONE_NOT_GRANTED", "O número não pertence à autorização deste cadastro");
  const token = decryptOfficialToken(attempt.tokenEnc, { organizationId: scope.orgId, connectionId: id });
  let phone: schema.PhoneCandidate;
  try {
    const phones = (await graph.readPhones(token, attempt.wabaId!)).flatMap(page => schema.phonePageSchema.parse(page).data);
    const selected = phones.find(item => item.id === phoneNumberId && item.is_on_biz_app && item.platform_type === "CLOUD_API");
    if (!selected) throw conflict("OFFICIAL_PHONE_NOT_GRANTED", "O número não está disponível em Coexistence nesta conta");
    phone = selected;
  } catch (error) {
    if (error instanceof Error && "expose" in error && error.expose === true) throw error;
    throw httpError(502, "OFFICIAL_VERIFICATION_FAILED", "Não foi possível conferir o número na Meta");
  }
  const connection = await repo.prepareConnection(scope, id, phone, token, actor);
  await resumeConnection(scope.orgId, connection.id);
  return { connection: await getConnection(scope.orgId, connection.id), syncs: await repo.listSyncs(scope.orgId, connection.id) };
};

export const syncStatus = async (scope: repo.OnboardingScope, connectionId: string) => {
  await requireManager(scope);
  await getConnection(scope.orgId, connectionId);
  return repo.listSyncs(scope.orgId, connectionId);
};
