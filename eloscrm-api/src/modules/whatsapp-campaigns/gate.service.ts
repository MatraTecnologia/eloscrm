import { httpError } from "../../lib/http-error.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import { campaignInputSchema } from "./campaigns.schema.js";
import { preview } from "./preview.service.js";
import * as repo from "./campaigns.repo.js";
import { requireManager } from "../whatsapp-costs/costs.service.js";
import { globalFailure, RECIPIENT_CHANGED } from "./failures.js";

export const checkCampaign = async (orgId: string, recipientId: string) => {
  const row = await repo.recipient(orgId, recipientId);
  if (!row || !["running", "paused"].includes(row.campaign.status) || row.status !== "preparing" || !row.leaseExpiresAt || row.leaseExpiresAt <= new Date()) throw httpError(422, "CAMPAIGN_STOPPED", "Campanha cancelada ou com execução expirada");
  await requireManager(orgId, row.campaign.actorUserId);
  const input = campaignInputSchema.parse(row.campaign.input);
  const imported = input.importedAudience?.recipients.find(value => `import:${value.phone}` === row.dealId);
  let current: Awaited<ReturnType<typeof preview>>;
  try { current = await preview(orgId, imported ? { ...input, importedAudience: { ...input.importedAudience!, recipients: [imported] } } : { ...input, dealIds: [row.dealId] }); }
  catch (error) {
    // Conexão, token ou template indisponível não são problema do arquivo: o worker pausa com o motivo certo.
    if (!input.headerUploadId || globalFailure(error instanceof Error && "code" in error ? String(error.code) : null, null)) throw error;
    await repo.pause(orgId, row.campaignId);
    throw httpError(422, "CAMPAIGN_TEMPLATE_CHANGED", "Não foi possível confirmar o arquivo do cabeçalho; a campanha foi pausada para revisão");
  }
  const target = current.rows.find(value => value.dealId === row.dealId);
  const snapshot = row.campaign.snapshot as unknown as Awaited<ReturnType<typeof preview>>;
  // Lead que escreve no meio do disparo ganha a identidade do provedor no mesmo contato. A pessoa e o
  // destino são os mesmos: o envio segue pela identidade congelada, que o outbound revalida.
  const sameIdentity = target?.identityId === row.identityId && target.identityHash === row.identityHash;
  const promoted = !sameIdentity && !!target && target.contactId === row.contactId && !!await repo.activeIdentity(orgId, row.identityId, row.contactId);
  // Template e arquivo valem para todos: mudou um, mudou a campanha inteira.
  if (eventHash(current.template) !== eventHash(snapshot.template) || eventHash(current.headerMedia ?? null) !== eventHash(snapshot.headerMedia ?? null)) {
    await repo.pause(orgId, row.campaignId);
    throw httpError(422, "CAMPAIGN_TEMPLATE_CHANGED", "O template ou o arquivo do cabeçalho mudou desde a aprovação");
  }
  // O resto é de um destinatário só. Um card movido ou um lead renomeado no meio de um disparo de uma
  // hora não pode parar os outros: este fica de fora e a fila segue.
  if (!target || target.exclusion) throw httpError(422, RECIPIENT_CHANGED, `Não enviado: ${target?.exclusion ?? "Negócio indisponível ou fora dos filtros"} (mudou durante o disparo)`);
  if (target.clientId !== row.clientId || target.contactId !== row.contactId || (!sameIdentity && !promoted)) throw httpError(422, RECIPIENT_CHANGED, "Não enviado: o contato do lead mudou durante o disparo");
  if (eventHash(target.parameters) !== eventHash(row.parameters)) throw httpError(422, RECIPIENT_CHANGED, "Não enviado: os dados personalizados do lead mudaram durante o disparo");
  if (eventHash(target.cost) !== eventHash(row.costSnapshot)) {
    await repo.pause(orgId, row.campaignId);
    throw httpError(422, "CAMPAIGN_CHANGED", "A tarifa mudou desde a aprovação; a campanha foi pausada. Continue para aplicar a tarifa atual aos envios restantes");
  }
};
