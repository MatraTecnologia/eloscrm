import { createWorker, enqueue, queueEnabled } from "../../lib/queue.js";
import { createSend, executeSend, getCommand } from "../whatsapp-outbound/outbound.service.js";
import { campaignInputSchema, parametersSchema } from "./campaigns.schema.js";
import { checkCampaign } from "./gate.service.js";
import { globalFailure, preSubmissionFailure, RECIPIENT_CHANGED, REVIEW_CODES } from "./failures.js";
import * as repo from "./campaigns.repo.js";

export const CAMPAIGN_QUEUE = "official-campaign-dispatch";
export const processCampaign = async ({ orgId, campaignId }: { orgId: string; campaignId: string }) => {
  if (!queueEnabled()) return;
  const claim = await repo.claim(orgId, campaignId);
  if (!claim) return;
  const row = await repo.recipient(orgId, claim.id);
  if (!row) return;
  // Mudança de template, arquivo ou tarifa pede revisão; falha da conexão ou da conta pausa. Nos dois
  // casos o destinatário volta para a fila, e o comando que não chegou à Meta deixa de ser dele.
  const hold = (reason: string, code: string | null, commandId?: string) => repo.holdForRetry(orgId, row.id, claim.leaseToken, reason, code, { commandId, status: code && REVIEW_CODES.has(code) ? "needs_review" : "paused" });
  try {
    // Um comando já submetido nunca é repetido, mesmo se o worker morreu antes de salvar o resultado.
    if (row.command && !["pending", "preparing"].includes(row.command.status)) {
      const reason = row.command.status === "failed" ? globalFailure(null, row.command.providerErrorCode) : null;
      if (reason) return void await hold(`Disparo pausado: ${reason}`, String(row.command.providerErrorCode), row.command.id);
      await repo.settle(orgId, row.id, claim.leaseToken, row.command.status === "accepted" ? "sent" : row.command.status === "failed" ? "failed" : "unknown", row.command.safeError);
      return;
    }
    await checkCampaign(orgId, row.id);
    const input = campaignInputSchema.parse(row.campaign.input);
    // A chave muda a cada tentativa: um destinatário devolvido à fila depois de uma pausa não pode
    // reencontrar o comando que falhou antes de chegar à Meta.
    const command = row.command ?? await createSend(orgId, row.campaign.connectionId, { type: "template", templateId: input.templateId, ...(input.headerUploadId ? { headerUploadId: input.headerUploadId } : {}), identityId: row.identityId, parameters: parametersSchema.parse(row.parameters), idempotencyKey: row.attempts > 1 ? `campaign:${row.id}:${row.attempts}` : `campaign:${row.id}` }, { id: row.campaign.actorUserId, name: row.campaign.actorName, source: "AUTOMATION" }, row.id);
    const failure = await executeSend(orgId, command.id);
    const saved = await getCommand(orgId, command.id);
    if (saved.status === "failed" && failure) {
      if (failure.code === RECIPIENT_CHANGED) return void await repo.settle(orgId, row.id, claim.leaseToken, "skipped", saved.safeError, { code: RECIPIENT_CHANGED, stage: "preparation" });
      if (failure.code && REVIEW_CODES.has(failure.code)) return void await hold(saved.safeError ?? "A campanha precisa de revisão", failure.code, command.id);
      const reason = globalFailure(failure.code, failure.providerCode) ?? (!failure.submitted && (failure.providerCode !== null || failure.unanswered) ? preSubmissionFailure(failure.providerCode) : null);
      if (reason) return void await hold(`Disparo pausado: ${reason}`, failure.providerCode === null ? failure.code : String(failure.providerCode), command.id);
    }
    await repo.settle(orgId, row.id, claim.leaseToken, saved.status === "accepted" ? "sent" : saved.status === "failed" ? "failed" : ["pending", "preparing"].includes(saved.status) ? "pending" : "unknown", saved.safeError, saved.status === "failed" || saved.status === "uncertain" ? { code: saved.providerErrorCode === null ? "PROVIDER_UNCONFIRMED" : String(saved.providerErrorCode), stage: "provider" } : undefined);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    const safeError = error instanceof Error && "expose" in error && error.expose === true ? error.message : "Não foi possível preparar este envio";
    if (code && REVIEW_CODES.has(code)) return void await hold(safeError, code);
    const reason = globalFailure(code, null);
    if (reason) return void await hold(`Disparo pausado: ${reason}`, code);
    await repo.settle(orgId, row.id, claim.leaseToken, code === "CAMPAIGN_STOPPED" || code === RECIPIENT_CHANGED ? "skipped" : "failed", safeError, { code: code && /^[A-Z0-9_]{1,80}$/.test(code) ? code : "PREPARATION_FAILED", stage: "preparation" });
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
