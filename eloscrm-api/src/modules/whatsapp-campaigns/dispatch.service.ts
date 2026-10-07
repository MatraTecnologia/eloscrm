import { createWorker, enqueue, queueEnabled } from "../../lib/queue.js";
import { createSend, executeSend, getCommand } from "../whatsapp-outbound/outbound.service.js";
import { campaignInputSchema, parametersSchema } from "./campaigns.schema.js";
import { checkCampaign } from "./gate.service.js";
import * as repo from "./campaigns.repo.js";

export const CAMPAIGN_QUEUE = "official-campaign-dispatch";
export const processCampaign = async ({ orgId, campaignId }: { orgId: string; campaignId: string }) => {
  if (!queueEnabled()) return;
  const claim = await repo.claim(orgId, campaignId);
  if (!claim) return;
  const row = await repo.recipient(orgId, claim.id);
  if (!row) return;
  try {
    // Um comando já submetido nunca é repetido, mesmo se o worker morreu antes de salvar o resultado.
    if (row.command && !["pending", "preparing"].includes(row.command.status)) {
      await repo.settle(orgId, row.id, claim.leaseToken, row.command.status === "accepted" ? "sent" : row.command.status === "failed" ? "failed" : "unknown", row.command.safeError);
      return;
    }
    await checkCampaign(orgId, row.id);
    const input = campaignInputSchema.parse(row.campaign.input);
    const command = row.command ?? await createSend(orgId, row.campaign.connectionId, { type: "template", templateId: input.templateId, ...(input.headerUploadId ? { headerUploadId: input.headerUploadId } : {}), identityId: row.identityId, parameters: parametersSchema.parse(row.parameters), idempotencyKey: `campaign:${row.id}` }, { id: row.campaign.actorUserId, name: row.campaign.actorName, source: "AUTOMATION" }, row.id);
    await executeSend(orgId, command.id);
    const saved = await getCommand(orgId, command.id);
    await repo.settle(orgId, row.id, claim.leaseToken, saved.status === "accepted" ? "sent" : saved.status === "failed" ? "failed" : ["pending", "preparing"].includes(saved.status) ? "pending" : "unknown", saved.safeError, saved.status === "failed" || saved.status === "uncertain" ? { code: saved.providerErrorCode === null ? "PROVIDER_UNCONFIRMED" : String(saved.providerErrorCode), stage: "provider" } : undefined);
    if (saved.status === "failed" && saved.safeError?.toLowerCase().includes("template")) await repo.pause(orgId, row.campaignId);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    const safeError = error instanceof Error && "expose" in error && error.expose === true ? error.message : "Não foi possível preparar este envio";
    await repo.settle(orgId, row.id, claim.leaseToken, code === "CAMPAIGN_SUPPRESSED" || code === "CAMPAIGN_STOPPED" ? "skipped" : "failed", safeError, { code: code && /^[A-Z0-9_]{1,80}$/.test(code) ? code : "PREPARATION_FAILED", stage: "preparation" });
  }
};
createWorker<{ orgId: string; campaignId: string }>(CAMPAIGN_QUEUE, async job => processCampaign(job.data), 1);
export const recoverCampaigns = async () => {
  if (!queueEnabled()) return;
  for (const campaign of await repo.pendingCampaigns()) await enqueue(CAMPAIGN_QUEUE, { orgId: campaign.organizationId, campaignId: campaign.id }, { attempts: 1, jobId: `${campaign.id}-${Math.floor(Date.now() / 10000)}` });
};
export const scheduleCampaignRecovery = () => {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await recoverCampaigns(); } catch { /* A intenção persiste no banco para o próximo ciclo. */ } finally { running = false; } };
  const timer = setInterval(() => { void tick(); }, 10000); timer.unref(); void tick();
  return () => clearInterval(timer);
};
