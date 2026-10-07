import type { Prisma } from "../../generated/prisma/client.js";
import { httpError } from "../../lib/http-error.js";
import { campaignInputSchema } from "./campaigns.schema.js";

export const checkSubmission = async (tx: Prisma.TransactionClient, orgId: string, recipientId: string) => {
  const reference = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, id: recipientId }, select: { campaignId: true } });
  if (!reference) throw httpError(422, "CAMPAIGN_STOPPED", "Destinatário da campanha indisponível");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}:${reference.campaignId}`}, 0))`;
  const recipient = await tx.officialCampaignRecipient.findFirst({ where: { organizationId: orgId, id: recipientId }, include: { campaign: { select: { id: true, status: true, input: true } } } });
  if (!recipient || !["running", "paused"].includes(recipient.campaign.status) || recipient.status !== "preparing" || !recipient.leaseExpiresAt || recipient.leaseExpiresAt <= new Date()) throw httpError(422, "CAMPAIGN_STOPPED", "Campanha cancelada ou com execução expirada");
  const imported = campaignInputSchema.parse(recipient.campaign.input).importedAudience?.recipients.find(value => `import:${value.phone}` === recipient.dealId);
  if (imported) {
    const identity = await tx.contactIdentity.findFirst({ where: { organizationId: orgId, id: recipient.identityId }, select: { value: true } });
    if (identity?.value !== imported.phone) throw httpError(422, "CAMPAIGN_CHANGED", "A identidade do destinatário importado mudou");
  }
};
