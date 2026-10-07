import { prisma } from "../../lib/prisma.js";
import { notFound, conflict } from "../../lib/http-error.js";
import { publicConnectionSelect } from "../channel-connections/channel-connections.repo.js";
import { recordAudit } from "../../lib/audit.js";
import type { Actor } from "../../lib/actor.js";

export const removeUazapiInstancePreservingHistory = (orgId: string, instanceId: string) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`uazapi-history:${orgId}:${instanceId}`}, 0))::text`;
  const instance = await tx.uazapiInstance.findFirst({ where: { id: instanceId, organizationId: orgId } });
  if (!instance) throw notFound("Instância não encontrada nesta imobiliária");
  const connection = await tx.channelConnection.findFirst({ where: { organizationId: orgId, uazapiInstanceId: instanceId } })
    ?? await tx.channelConnection.create({ data: { organizationId: orgId, provider: "uazapi", label: instance.profileName || instance.name, uazapiInstanceId: instanceId, status: "disabled" } });
  await tx.conversation.updateMany({ where: { organizationId: orgId, instanceId, connectionId: null }, data: { connectionId: connection.id } });
  await tx.whatsappMessage.updateMany({ where: { organizationId: orgId, connectionId: null, conversation: { organizationId: orgId, instanceId } }, data: { connectionId: connection.id } });
  await tx.conversation.updateMany({ where: { organizationId: orgId, instanceId }, data: { instanceId: null } });
  await tx.channelConnection.updateMany({ where: { organizationId: orgId, uazapiInstanceId: instanceId }, data: { uazapiInstanceId: null, status: "disabled", disabledAt: new Date(), tokenEnc: null } });
  await tx.uazapiInstance.delete({ where: { id: instanceId, organizationId: orgId } });
});

export const disableConnection = (orgId: string, connectionId: string, actor: Actor) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-connection:${orgId}:${connectionId}`}, 0))::text`;
  const connection = await tx.channelConnection.findFirst({ where: { organizationId: orgId, id: connectionId } });
  if (!connection) throw notFound("Conexão não encontrada nesta imobiliária");
  if (connection.provider !== "cloud_api") throw conflict("UAZAPI_DISCONNECT_SEPARATE", "Desconecte a instância uazapi na aba da integração");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-dispatch:${orgId}:${connectionId}`}, 0))::text`;
  const campaigns = await tx.officialCampaign.findMany({ where: { organizationId: orgId, connectionId }, select: { id: true }, orderBy: { id: "asc" } });
  for (const campaign of campaigns) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${campaign.id}`}, 0))::text`;
  const cancelable = await tx.officialSendCommand.findMany({ where: { organizationId: orgId, connectionId, status: { in: ["pending", "preparing"] } }, select: { id: true, messageId: true } });
  const canceledCommands = await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, id: { in: cancelable.map(command => command.id) }, status: { in: ["pending", "preparing"] } }, data: { status: "failed", safeError: "Conexão desativada antes do envio", leaseToken: null, leaseExpiresAt: null } });
  await tx.whatsappMessage.updateMany({ where: { organizationId: orgId, id: { in: cancelable.map(command => command.messageId) }, status: "pending" }, data: { status: "failed" } });
  // A submissão já iniciada pode ter chegado à Meta. Mantém a lease para confirmar respostas tardias.
  const uncertainCommands = await tx.officialSendCommand.updateMany({ where: { organizationId: orgId, connectionId, status: "sending" }, data: { status: "uncertain", safeError: "Conexão desativada durante o envio; aguarde a confirmação da Meta" } });
  await tx.officialCampaign.updateMany({ where: { organizationId: orgId, connectionId, status: { in: ["draft", "needs_review", "running"] } }, data: { status: "canceled" } });
  const pendingRecipients = { organizationId: orgId, campaignId: { in: campaigns.map(campaign => campaign.id) }, status: { in: ["pending", "preparing"] } };
  await tx.officialCampaignRecipient.updateMany({ where: { ...pendingRecipients, command: { status: "uncertain" } }, data: { status: "unknown", safeError: "Conexão desativada; resultado do envio não confirmado", leaseToken: null, leaseExpiresAt: null } });
  await tx.officialCampaignRecipient.updateMany({ where: { ...pendingRecipients, OR: [{ command: null }, { command: { status: "failed" } }] }, data: { status: "skipped", safeError: "Conexão desativada", leaseToken: null, leaseExpiresAt: null } });
  await tx.officialSyncRequest.updateMany({ where: { organizationId: orgId, connectionId, status: { in: ["pending", "requesting", "accepted", "receiving"] } }, data: { status: "failed", lastErrorCode: "OFFICIAL_CONNECTION_DISABLED" } });
  const saved = await tx.channelConnection.update({ where: { organizationId: orgId, id: connectionId }, data: { status: "disabled", disabledAt: connection.disabledAt ?? new Date(), tokenEnc: null, tokenExpiresAt: null }, select: publicConnectionSelect });
  if (connection.status !== "disabled") await recordAudit({ orgId, entityType: "ORGANIZATION", entityId: orgId, action: "DISCONNECTED", actor, context: { connectionId, operation: "local_disable", canceledCommands: canceledCommands.count, uncertainCommands: uncertainCommands.count, remoteDisconnected: false } }, tx);
  return { connection: saved, canceledCommands: canceledCommands.count, uncertainCommands: uncertainCommands.count, remoteDisconnected: false };
}, { timeout: 15_000 });
