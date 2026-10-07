import { createHash, randomUUID } from "node:crypto";
import { Prisma, AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict } from "../../lib/http-error.js";
import { encryptOfficialToken } from "../../lib/whatsapp-official/crypto.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import { publicConnectionSelect } from "../channel-connections/channel-connections.repo.js";
import type { PhoneCandidate } from "./onboarding.schema.js";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type OnboardingScope = { orgId: string; userId: string; sessionId: string };
const scopeWhere = (scope: OnboardingScope) => ({ organizationId: scope.orgId, userId: scope.userId, sessionHash: hash(scope.sessionId) });
export const create = (scope: OnboardingScope) => prisma.officialOnboarding.create({ data: {
  ...scopeWhere(scope), expiresAt: new Date(Date.now() + 30 * 60_000), syncDeadlineAt: new Date(Date.now() + 24 * 60 * 60_000),
} });
export const find = (scope: OnboardingScope, id: string) => prisma.officialOnboarding.findFirst({ where: { ...scopeWhere(scope), id } });
export const claimExchange = async (scope: OnboardingScope, id: string, code: string) => {
  try {
    const result = await prisma.officialOnboarding.updateMany({
      where: { ...scopeWhere(scope), id, status: "pending", expiresAt: { gt: new Date() } },
      data: { status: "exchanging", codeHash: hash(code) },
    });
    return result.count === 1;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("OFFICIAL_CODE_REUSED", "Este cadastro já foi utilizado");
    throw error;
  }
};
export const update = (scope: OnboardingScope, id: string, data: Prisma.OfficialOnboardingUpdateManyMutationInput) => prisma.officialOnboarding.updateMany({ where: { ...scopeWhere(scope), id }, data });

export const prepareConnection = (scope: OnboardingScope, id: string, phone: PhoneCandidate, accessToken: string, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-attempt:${id}`}, 0))::text`;
  const attempt = await tx.officialOnboarding.findFirstOrThrow({ where: { ...scopeWhere(scope), id } });
  if (attempt.status === "completed") return tx.channelConnection.findFirstOrThrow({ where: { id: attempt.connectionId!, organizationId: scope.orgId }, select: publicConnectionSelect });
  if (attempt.status !== "verified" || attempt.expiresAt <= new Date()) throw conflict("OFFICIAL_ATTEMPT_UNAVAILABLE", "O cadastro expirou ou não está pronto para concluir");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-onboarding:${attempt.wabaId}`}, 0))::text`;
  const foreign = await tx.channelConnection.findFirst({ where: {
    provider: "cloud_api", OR: [{ phoneNumberId: phone.id }, { wabaId: attempt.wabaId }], organizationId: { not: scope.orgId },
  }, select: { id: true } });
  if (foreign) throw conflict("WHATSAPP_NUMBER_UNAVAILABLE", "Os ativos já estão vinculados a outra imobiliária");
  const existing = await tx.channelConnection.findFirst({ where: { organizationId: scope.orgId, phoneNumberId: phone.id } });
  if (existing && (existing.wabaId !== attempt.wabaId || existing.businessPortfolioId !== attempt.businessPortfolioId)) throw conflict("WHATSAPP_ASSET_CHANGED", "Os vínculos deste número mudaram; revise a conexão");
  const connectionId = existing?.id ?? randomUUID();
  const data = {
    provider: "cloud_api" as const, status: "pending" as const, label: phone.verified_name || "WhatsApp oficial",
    businessPortfolioId: attempt.businessPortfolioId, wabaId: attempt.wabaId, phoneNumberId: phone.id,
    displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name ?? null,
    currency: attempt.currency, timezoneId: attempt.timezoneId, isOnBusinessApp: true,
    tokenEnc: encryptOfficialToken(accessToken, { organizationId: scope.orgId, connectionId }), tokenExpiresAt: attempt.tokenExpiresAt, disabledAt: null,
  };
  const connection = existing
    ? await tx.channelConnection.update({ where: { id: connectionId, organizationId: scope.orgId }, data, select: publicConnectionSelect })
    : await tx.channelConnection.create({ data: { ...data, id: connectionId, organizationId: scope.orgId }, select: publicConnectionSelect });
  for (const syncType of ["smb_app_state_sync", "history"]) {
    await tx.officialSyncRequest.upsert({
      where: { connectionId_syncType: { connectionId, syncType } },
      create: { organizationId: scope.orgId, connectionId, syncType, deadlineAt: attempt.syncDeadlineAt },
      // Novo login renova a credencial, mas não prova offboarding nem autoriza repetir a sync.
      update: {},
    });
  }
  await tx.officialOnboarding.updateMany({ where: { ...scopeWhere(scope), id, status: "verified" }, data: { connectionId, status: "completed", tokenEnc: null } });
  await recordAudit({ orgId: scope.orgId, entityType: AuditEntity.ORGANIZATION, entityId: scope.orgId, action: AuditAction.CONNECTED, actor,
    context: { provider: "cloud_api", connectionId, operation: "coexistence_onboarding" },
  }, tx);
  return connection;
}, { timeout: 15_000 });

export const syncSelect = { id: true, syncType: true, status: true, requestId: true, deadlineAt: true, requestedAt: true, progress: true, lastErrorCode: true, updatedAt: true } satisfies Prisma.OfficialSyncRequestSelect;
export const listSyncs = (orgId: string, connectionId: string) => prisma.officialSyncRequest.findMany({ where: { organizationId: orgId, connectionId }, select: syncSelect, orderBy: { syncType: "asc" } });

export const recoverExchanges = async () => {
  await prisma.officialOnboarding.updateMany({ where: { status: "exchanging", updatedAt: { lt: new Date(Date.now() - 60_000) } }, data: { status: "uncertain", lastErrorCode: "OFFICIAL_EXCHANGE_UNCERTAIN" } });
  await prisma.officialOnboarding.updateMany({ where: { status: { in: ["pending", "verified"] }, expiresAt: { lte: new Date() } }, data: { status: "failed", tokenEnc: null, lastErrorCode: "OFFICIAL_ATTEMPT_EXPIRED" } });
};
