import type { Prisma } from "../../generated/prisma/client.js";
import { httpError } from "../../lib/http-error.js";
import { allowed } from "../communication-permissions/permissions.repo.js";
import { phoneKey } from "../../lib/phone.js";

export const checkSubmission = async (tx: Prisma.TransactionClient, orgId: string, recipientId: string) => {
  const reference = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, id: recipientId }, select: { campaignId: true } });
  if (!reference) throw httpError(422, "CAMPAIGN_STOPPED", "Destinatário da campanha indisponível");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${reference.campaignId}`}, 0))`;
  const recipient = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, id: recipientId }, include: { campaign: { select: { id: true, status: true } } } });
  if (!recipient || recipient.campaign.status !== "running" || recipient.status !== "preparing" || !recipient.leaseExpiresAt || recipient.leaseExpiresAt <= new Date()) throw httpError(422, "CAMPAIGN_STOPPED", "Campanha cancelada, pausada ou com execução expirada");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`permissions:${orgId}`}, 0))`;
  const identity = await tx.contactIdentity.findFirst({ where: { organizationId: orgId, id: recipient.identityId }, select: { value: true, kind: true } });
  if (!await allowed(orgId, recipient.clientId, identity && ["wa_id", "phone"].includes(identity.kind) ? phoneKey(identity.value) : null, tx)) throw httpError(422, "CAMPAIGN_SUPPRESSED", "Permissão ausente ou comunicação descadastrada");
};
