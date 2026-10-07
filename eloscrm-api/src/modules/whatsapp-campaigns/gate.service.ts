import { httpError } from "../../lib/http-error.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import * as permissions from "../communication-permissions/permissions.repo.js";
import { campaignInputSchema } from "./campaigns.schema.js";
import { preview } from "./preview.service.js";
import * as repo from "./campaigns.repo.js";
import { requireManager } from "../whatsapp-costs/costs.service.js";
import { phoneKey } from "../../lib/phone.js";
import { identity } from "../whatsapp-outbound/outbound.repo.js";

export const checkCampaign = async (orgId: string, recipientId: string) => {
  const row = await repo.recipient(orgId, recipientId);
  if (!row || row.campaign.status !== "running" || row.status !== "preparing" || !row.leaseExpiresAt || row.leaseExpiresAt <= new Date()) throw httpError(422, "CAMPAIGN_STOPPED", "Campanha cancelada, pausada ou com execução expirada");
  await requireManager(orgId, row.campaign.actorUserId);
  const destination = await identity(orgId, row.identityId);
  if (!await permissions.allowed(orgId, row.clientId, destination && ["wa_id", "phone"].includes(destination.kind) ? phoneKey(destination.value) : null)) throw httpError(422, "CAMPAIGN_SUPPRESSED", "Permissão ausente ou comunicação descadastrada");
  const input = campaignInputSchema.parse(row.campaign.input);
  let current: Awaited<ReturnType<typeof preview>>;
  try { current = await preview(orgId, { ...input, dealIds: [row.dealId] }); }
  catch (error) {
    if (!input.headerUploadId) throw error;
    await repo.pause(orgId, row.campaignId);
    throw httpError(422, "CAMPAIGN_CHANGED", "Não foi possível confirmar o arquivo e o template; a campanha foi pausada para revisão");
  }
  const target = current.rows.find(value => value.dealId === row.dealId);
  const snapshot = row.campaign.snapshot as unknown as Awaited<ReturnType<typeof preview>>;
  if (!target || target.exclusion || target.clientId !== row.clientId || target.contactId !== row.contactId || target.identityId !== row.identityId || target.identityHash !== row.identityHash || eventHash(target.parameters) !== eventHash(row.parameters) || eventHash(target.cost) !== eventHash(row.costSnapshot) || eventHash(current.template) !== eventHash(snapshot.template) || eventHash(current.headerMedia ?? null) !== eventHash(snapshot.headerMedia ?? null)) {
    await repo.pause(orgId, row.campaignId);
    throw httpError(422, "CAMPAIGN_CHANGED", "Público, dados personalizados, identidade, template, arquivo ou tarifa mudou; a campanha foi pausada para revisão");
  }
};
