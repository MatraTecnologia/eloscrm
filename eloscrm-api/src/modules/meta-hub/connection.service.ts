import { prisma } from "../../lib/prisma.js";
import { Prisma, type ChannelConnection, type ChannelConnectionStatus, type OfficialSyncStatus } from "../../generated/prisma/client.js";
import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";
import * as hub from "../../lib/meta-hub/client.js";
import { hubConnectionSchema, hubDisconnectMetaSchema, type HubConnectionData } from "./connection.schema.js";

type Tx = Prisma.TransactionClient;
export type ConnectionOutcome = { status: "processed" | "unsupported" | "failed"; code?: string; connectionId?: string };
// fromReturn: GET do retorno do navegador com status=connected, que prova uma sessão nova
type ApplyOptions = { meta?: unknown; fromGet?: boolean; fromReturn?: boolean; actor: Actor };

// error e disconnected viram disconnected local; o motivo fica em hubErrorCode (§2.5)
const STATUS: Record<string, ChannelConnectionStatus> = { active: "connected", pending: "pending", error: "disconnected", disconnected: "disconnected" };
const TERMINAL_SYNC: OfficialSyncStatus[] = ["complete", "declined", "failed", "expired"];
const OPEN_COMMANDS = ["pending", "preparing", "sending", "uncertain"] as const;

// sync[] do hub → OfficialSyncRequest (§3.1). `requested` vira `accepted`, não `pending`: `pending`
// é o "vá pedir" do job antigo de sync, que não pode agir numa conexão do hub.
const syncStatus = (status: string, errorCode?: string | null): OfficialSyncStatus => {
  if (status === "completed") return "complete";
  if (status === "requested" || status === "accepted") return "accepted";
  if (errorCode === "declined_by_business") return "declined";
  if (errorCode === "sync_window_expired") return "expired";
  if (errorCode === "sync_uncertain") return "uncertain";
  return "failed";
};

const applySync = async (tx: Tx, row: Pick<ChannelConnection, "id" | "organizationId">, data: HubConnectionData, overwrite: boolean) => {
  const deadlineAt = new Date(new Date(data.createdAt).getTime() + 24 * 60 * 60 * 1000);
  for (const item of data.sync ?? []) {
    if (!["history", "smb_app_state_sync"].includes(item.type)) continue;
    const status = syncStatus(item.status, item.errorCode);
    const values = { status, progress: Math.floor(item.progress ?? 0), lastErrorCode: item.errorCode ?? null, deadlineAt };
    const current = await tx.officialSyncRequest.findUnique({ where: { connectionId_syncType: { connectionId: row.id, syncType: item.type } } });
    if (!current) { await tx.officialSyncRequest.create({ data: { ...values, organizationId: row.organizationId, connectionId: row.id, syncType: item.type } }); continue; }
    // estado terminal nunca regride, salvo na ligação, que regrava o que o disable deixou `failed`
    if (!overwrite && TERMINAL_SYNC.includes(current.status)) continue;
    await tx.officialSyncRequest.update({ where: { id: current.id }, data: { ...values, progress: overwrite ? values.progress : Math.max(current.progress, values.progress) } });
  }
};

const disconnectReason = (meta: unknown) => hubDisconnectMetaSchema.safeParse(meta).data?.reason;

const applyToRow = async (tx: Tx, row: ChannelConnection, data: HubConnectionData, options: ApplyOptions, overwriteSync: boolean): Promise<string | undefined> => {
  const update: Prisma.ChannelConnectionUncheckedUpdateInput = {};
  let code: string | undefined;
  const updatedAt = new Date(data.updatedAt);
  // Disable é local, sem DELETE (§3.1): só uma sessão posterior a ele o desfaz. A reconexão volta a
  // pending (hub:618), mas o GET do retorno pode já ler active, porque a ativação roda em segundo plano.
  if (row.status === "disabled") {
    const reconnected = Boolean(row.disabledAt && updatedAt > row.disabledAt)
      && (data.status === "pending" || (options.fromReturn === true && data.status === "active"));
    // congela sem avançar a marca: o active que chegou antes do pending é reaplicado na retentativa
    if (!reconnected) return "HUB_CONNECTION_DISABLED";
    update.disabledAt = null;
    overwriteSync = true;
  }
  // ordem pelo data.updatedAt da conexão, igual no evento e no GET (§5.2); `>=` torna a reaplicação idempotente
  if (!row.hubUpdatedAt || updatedAt >= row.hubUpdatedAt) {
    const mapped = STATUS[data.status];
    if (!mapped) code = "HUB_STATUS_UNKNOWN";
    else update.status = mapped;
    if (mapped) {
      const reason = disconnectReason(options.meta);
      update.hubErrorCode = data.status === "error" ? data.errorCode ?? "unknown"
        : data.status === "disconnected" ? (reason ? (reason === "api" ? null : reason) : row.status === "disconnected" ? row.hubErrorCode : null)
        : null;
    }
    // null também sai quando a credencial foi apagada: só espelha com active (§2.5)
    if (data.status === "active") update.tokenExpiresAt = data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null;
    if (data.health !== undefined) update.hubHealth = data.health === null ? Prisma.JsonNull : data.health as Prisma.InputJsonValue;
    if (data.whatsapp) Object.assign(update, {
      displayPhoneNumber: data.whatsapp.displayPhoneNumber ?? row.displayPhoneNumber, verifiedName: data.whatsapp.verifiedName ?? row.verifiedName,
      isOnBusinessApp: data.whatsapp.isOnBizApp ?? row.isOnBusinessApp, qualityRating: data.whatsapp.qualityRating ?? row.qualityRating,
    });
    update.hubUpdatedAt = updatedAt;
  }
  // fora da marca de ordem: a releitura diária do hub não mexe no updatedAt (§5.2); nulo não apaga
  if (data.whatsapp?.currency) update.currency = data.whatsapp.currency;
  if (data.whatsapp?.timezone) update.timezone = data.whatsapp.timezone;
  // o portfólio pode mudar no hub sem evento (hub:604): só alerta, porque muda o escopo do BSUID (R6)
  if (data.whatsapp?.businessId && row.businessPortfolioId && data.whatsapp.businessId !== row.businessPortfolioId) code ??= "HUB_BUSINESS_CHANGED";
  if (options.fromGet) update.hubCheckedAt = new Date();
  await tx.channelConnection.update({ where: { id: row.id }, data: update });
  await applySync(tx, row, data, overwriteSync);
  return code;
};

// mesma trava do disable local (lifecycle.repo.ts): sem ela, um evento lido antes do disable
// gravaria connected por cima de disabled. Relê a linha depois de travar.
const lockRow = async (tx: Tx, orgId: string, id: string) => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-connection:${orgId}:${id}`}, 0))::text`;
  return tx.channelConnection.findFirst({ where: { id, organizationId: orgId } });
};

// D5: liga a conexão do hub à linha da mesma org pelo número, nunca cria outra para o mesmo número
const link = async (tx: Tx, orgId: string, data: HubConnectionData, options: ApplyOptions): Promise<ConnectionOutcome & { deleteRemote?: boolean }> => {
  // dois eventos da mesma conexão desconhecida não podem ligar duas vezes
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hub-connection:${data.id}`}, 0))::text`;
  const found = await tx.channelConnection.findFirst({ where: { hubConnectionId: data.id }, select: { id: true, organizationId: true } });
  if (found) {
    if (found.organizationId !== orgId) return { status: "failed", code: "HUB_TENANT_MISMATCH" };
    const already = await lockRow(tx, orgId, found.id);
    if (!already) return { status: "failed", code: "HUB_TENANT_MISMATCH" };
    const code = await applyToRow(tx, already, data, options, false);
    return { status: code === "HUB_CONNECTION_DISABLED" ? "failed" : "processed", code, connectionId: already.id };
  }
  const whatsapp = data.whatsapp;
  // conexão disconnected cujo número foi para outro workspace (hub:603): nada a ligar
  if (!whatsapp) return { status: "processed" };
  // mesma trava do onboarding próprio: as duas ligações pelo mesmo WABA ficam em série
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-onboarding:${whatsapp.wabaId}`}, 0))::text`;
  // sem filtrar a org: phoneNumberId é único global e o número não passa para outra imobiliária
  const foreign = await tx.channelConnection.findFirst({ where: {
    provider: "cloud_api", organizationId: { not: orgId }, OR: [{ phoneNumberId: whatsapp.phoneNumberId }, { wabaId: whatsapp.wabaId }],
  }, select: { id: true } });
  if (foreign) return { status: "failed", code: "WHATSAPP_NUMBER_UNAVAILABLE", deleteRemote: data.status !== "disconnected" };
  const candidate = await tx.channelConnection.findFirst({ where: { organizationId: orgId, provider: "cloud_api", phoneNumberId: whatsapp.phoneNumberId }, select: { id: true } });
  const existing = candidate && await lockRow(tx, orgId, candidate.id);
  if (existing) {
    if (existing.wabaId !== whatsapp.wabaId || (whatsapp.businessId && existing.businessPortfolioId !== whatsapp.businessId)) return { status: "failed", code: "WHATSAPP_ASSET_CHANGED" };
    const open = await tx.officialSendCommand.count({ where: { organizationId: orgId, connectionId: existing.id, status: { in: [...OPEN_COMMANDS] } } });
    if (open) return { status: "failed", code: "HUB_COMMANDS_PENDING" };
    // o hub só reaproveita o id enquanto a conexão antiga existe (hub:618): o anterior é sobrescrito
    const linked = await tx.channelConnection.update({ where: { id: existing.id }, data: { hubConnectionId: data.id, hubUpdatedAt: null, disabledAt: null, tokenEnc: null, status: existing.status === "disabled" ? "pending" : existing.status } });
    const code = await applyToRow(tx, linked, data, options, true);
    await recordAudit({ orgId, entityType: AuditEntity.ORGANIZATION, entityId: orgId, action: AuditAction.CONNECTED, actor: options.actor, context: { provider: "cloud_api", connectionId: existing.id, operation: "hub_connection_linked" } }, tx);
    return { status: "processed", code, connectionId: existing.id };
  }
  const created = await tx.channelConnection.create({ data: {
    organizationId: orgId, provider: "cloud_api", status: "pending", label: whatsapp.verifiedName || "WhatsApp oficial",
    businessPortfolioId: whatsapp.businessId ?? null, wabaId: whatsapp.wabaId, phoneNumberId: whatsapp.phoneNumberId,
    isOnBusinessApp: whatsapp.isOnBizApp ?? false, hubConnectionId: data.id,
  } });
  const code = await applyToRow(tx, created, data, options, true);
  await recordAudit({ orgId, entityType: AuditEntity.ORGANIZATION, entityId: orgId, action: AuditAction.CONNECTED, actor: options.actor, context: { provider: "cloud_api", connectionId: created.id, operation: "hub_connection_created" } }, tx);
  return { status: "processed", code, connectionId: created.id };
};

/** Aplica uma conexão do hub (evento `connection.*` ou `GET`) à org dona do workspace. */
export const applyHubConnection = async (orgId: string, input: unknown, options: ApplyOptions): Promise<ConnectionOutcome> => {
  const parsed = hubConnectionSchema.safeParse(input);
  if (!parsed.success) return { status: "failed", code: "HUB_CONNECTION_INVALID" };
  const data = parsed.data;
  // lead_ads e kind desconhecido não são deste app (hub:603, hub:1732)
  if (data.kind !== "whatsapp") return { status: "unsupported" };
  const org = await prisma.organization.findFirst({ where: { id: orgId }, select: { hubWorkspaceId: true } });
  if (!org?.hubWorkspaceId || org.hubWorkspaceId !== data.workspaceId) return { status: "failed", code: "HUB_TENANT_MISMATCH" };
  const outcome = await prisma.$transaction(tx => link(tx, orgId, data, options), { timeout: 15_000 });
  // fora da transação: viva, a conexão prende o número no workspace errado (D5 passo 4)
  if (outcome.deleteRemote) await hub.deleteConnection(data.id).catch(() => {});
  return { status: outcome.status, code: outcome.code, connectionId: outcome.connectionId };
};
