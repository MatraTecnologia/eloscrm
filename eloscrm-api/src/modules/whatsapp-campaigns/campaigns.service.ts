import { conflict, httpError, notFound } from "../../lib/http-error.js";
import type { Actor } from "../../lib/actor.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import { queueEnabled } from "../../lib/queue.js";
import { syncTemplates } from "../whatsapp-outbound/outbound.service.js";
import { campaignInputSchema, type CreateInput } from "./campaigns.schema.js";
import { preview } from "./preview.service.js";
import * as repo from "./campaigns.repo.js";

export const get = async (orgId: string, id: string) => {
  const saved = await repo.campaign(orgId, id);
  if (!saved) throw notFound("Campanha não encontrada nesta imobiliária");
  return { id: saved.id, name: saved.name, connectionId: saved.connectionId, pipelineId: saved.pipelineId, status: saved.status, createdAt: saved.createdAt, snapshot: saved.snapshot,
    recipients: saved.recipients.map(row => ({ id: row.id, clientId: row.clientId, clientName: row.clientName, dealId: row.dealId, status: row.command?.status === "accepted" ? "sent" : row.command?.status === "uncertain" ? "unknown" : row.status === "skipped" ? "skipped" : row.command?.status === "failed" ? "failed" : row.status, safeError: row.command?.safeError ?? row.safeError, commandId: row.command?.id ?? null, messageId: row.command?.messageId ?? null, deliveryStatus: row.command?.message.status ?? null, cost: row.command?.message.cost ? { ...row.command.message.cost, amount: row.command.message.cost.amount?.toFixed() ?? null } : null })) };
};
export const create = async (orgId: string, raw: CreateInput, actor: Actor) => {
  const { name, idempotencyKey, previewHash, ...input } = raw;
  const requestHash = eventHash(raw);
  const previous = await repo.existing(orgId, idempotencyKey);
  if (previous) {
    if (previous.requestHash !== requestHash) throw conflict("CAMPAIGN_IDEMPOTENCY", "Esta chave já foi usada em outra campanha");
    return get(orgId, previous.id);
  }
  const snapshot = await preview(orgId, input);
  if (snapshot.previewHash !== previewHash) throw conflict("CAMPAIGN_CHANGED", "O público ou a previsão mudou; atualize o preview");
  if (!snapshot.eligible) throw httpError(422, "CAMPAIGN_NO_RECIPIENTS", "Nenhuma pessoa elegível nesta seleção");
  return get(orgId, await repo.create(orgId, input, snapshot, { name, idempotencyKey, requestHash }, actor));
};
export const repreview = async (orgId: string, id: string) => {
  const saved = await repo.campaign(orgId, id);
  if (!saved) throw notFound("Campanha não encontrada");
  return preview(orgId, campaignInputSchema.parse(saved.input));
};
export const approve = async (orgId: string, id: string, hash: string, start: boolean, actor: Actor) => {
  const saved = await repo.campaign(orgId, id);
  if (!saved) throw notFound("Campanha não encontrada");
  if (start && ["running", "done"].includes(saved.status) && saved.previewHash === hash) return get(orgId, id);
  if (!["draft", "needs_review"].includes(saved.status)) throw conflict("CAMPAIGN_STATE", "A campanha já foi iniciada ou cancelada");
  if (start && !queueEnabled()) throw httpError(503, "CAMPAIGN_REDIS_REQUIRED", "O envio de campanhas oficiais exige Redis configurado");
  // O catálogo remoto é atualizado antes da confirmação de início. Preview não chama a Meta.
  if (start) await syncTemplates(orgId, saved.connectionId);
  const snapshot = await repreview(orgId, id);
  if (snapshot.previewHash !== hash) throw conflict("CAMPAIGN_CHANGED", "Público, template ou custo mudou. Atualize a previsão antes de iniciar");
  if (!snapshot.eligible) throw httpError(422, "CAMPAIGN_NO_RECIPIENTS", "Nenhuma pessoa elegível nesta seleção");
  await repo.updateDraft(orgId, id, snapshot, start, actor);
  return get(orgId, id);
};
export const cancel = async (orgId: string, id: string, actor: Actor) => { await repo.cancel(orgId, id, actor); return get(orgId, id); };
