import { prisma } from "../../lib/prisma.js";
import { Prisma, type OfficialWebhookStatus } from "../../generated/prisma/client.js";
import { isSupportedEnvelope, type HubEnvelope } from "./webhook.schema.js";

export type HubTenant = { status: "pending" | "unresolved"; organizationId: string | null; connectionId: string | null; lastErrorCode: string | null };

// Exceção ao filtro por org: o evento assinado chega sem sessão, e o tenant sai do workspace que o
// próprio app criou (Organization.hubWorkspaceId), conferido com o externalId (§2.5 do plano).
export const resolveTenant = async (workspace: HubEnvelope["workspace"], hubConnectionId: string | null | undefined): Promise<HubTenant> => {
  const org = await prisma.organization.findFirst({ where: { hubWorkspaceId: workspace.id }, select: { id: true } });
  if (!org || (workspace.externalId && workspace.externalId !== org.id)) return { status: "unresolved", organizationId: null, connectionId: null, lastErrorCode: "HUB_WORKSPACE_UNKNOWN" };
  if (!hubConnectionId) return { status: "pending", organizationId: org.id, connectionId: null, lastErrorCode: null };
  const connection = await prisma.channelConnection.findFirst({ where: { hubConnectionId }, select: { id: true, organizationId: true } });
  // conexão ainda não ligada (o connection.* que a liga pode vir depois): o handler decide
  if (!connection) return { status: "pending", organizationId: org.id, connectionId: null, lastErrorCode: null };
  if (connection.organizationId !== org.id) return { status: "unresolved", organizationId: org.id, connectionId: null, lastErrorCode: "HUB_TENANT_MISMATCH" };
  return { status: "pending", organizationId: org.id, connectionId: connection.id, lastErrorCode: null };
};

export const capture = async (envelope: HubEnvelope, receivedAt: Date) => {
  const base = {
    hubEventId: envelope.id, type: envelope.type, envelopeAt: new Date(envelope.createdAt),
    hubWorkspaceId: envelope.workspace.id, hubConnectionId: envelope.connectionId ?? null,
    payload: envelope as unknown as Prisma.InputJsonObject, receivedAt, nextAttemptAt: receivedAt,
  };
  const tenant: HubTenant = isSupportedEnvelope(envelope)
    ? await resolveTenant(envelope.workspace, envelope.connectionId)
    : { status: "unresolved", organizationId: null, connectionId: null, lastErrorCode: null };
  const status: OfficialWebhookStatus = isSupportedEnvelope(envelope) ? tenant.status : "unsupported";
  // reentrega e reenvio manual repetem o id do envelope (hub:1108): a segunda gravação é no-op
  await prisma.hubWebhookEvent.createMany({
    data: [{ ...base, status, organizationId: tenant.organizationId, connectionId: tenant.connectionId, lastErrorCode: tenant.lastErrorCode }],
    skipDuplicates: true,
  });
};

const due = (now: Date, types: string[]): Prisma.HubWebhookEventWhereInput => ({
  type: { in: types },
  OR: [
    { status: { in: ["pending", "unresolved"] }, nextAttemptAt: { lte: now } },
    { status: "failed", attempts: { lt: 10 }, nextAttemptAt: { lte: now } },
    { status: "processing", leaseExpiresAt: { lte: now } },
  ],
});

// Só os tipos com handler nesta imagem: o resto fica `pending` para uma imagem que saiba tratá-los,
// em vez de ser descartado em silêncio (D6 do plano).
export const dueEvents = (now: Date, types: string[], limit = 100) => types.length
  ? prisma.hubWebhookEvent.findMany({ where: due(now, types), select: { id: true }, orderBy: [{ envelopeAt: "asc" }, { id: "asc" }], take: limit })
  : Promise.resolve([]);

export const claim = async (id: string, types: string[], leaseToken: string, now: Date) => {
  const result = await prisma.hubWebhookEvent.updateMany({
    where: { id, ...due(now, types) },
    data: { status: "processing", leaseToken, leaseExpiresAt: new Date(now.getTime() + 120_000), attempts: { increment: 1 } },
  });
  return result.count ? prisma.hubWebhookEvent.findFirst({ where: { id, leaseToken } }) : null;
};

export const attachTenant = (id: string, leaseToken: string, tenant: HubTenant) => prisma.hubWebhookEvent.updateMany({
  where: { id, leaseToken }, data: { organizationId: tenant.organizationId, connectionId: tenant.connectionId },
});

// `unresolved` é espera prevista (workspace ou conexão ligados depois, revisão do D5 passo 3): não
// gasta o orçamento de 10 tentativas do `failed` e volta a cada 5 min em vez de 1
export const finish = (id: string, leaseToken: string, status: OfficialWebhookStatus, lastErrorCode: string | null) => prisma.hubWebhookEvent.updateMany({
  where: { id, leaseToken, status: "processing" },
  data: {
    status, lastErrorCode, leaseToken: null, leaseExpiresAt: null,
    ...(status === "unresolved" ? { attempts: { decrement: 1 } } : {}),
    processedAt: status === "processed" ? new Date() : null, nextAttemptAt: new Date(Date.now() + (status === "unresolved" ? 300_000 : 60_000)),
  },
});
