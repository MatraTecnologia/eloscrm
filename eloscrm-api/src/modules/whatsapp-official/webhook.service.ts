import { randomUUID } from "node:crypto";
import { createWorker, enqueue } from "../../lib/queue.js";
import { forbidden, conflict, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import type { Actor } from "../../lib/actor.js";
import * as repo from "./webhook.repo.js";
import { processChange, safeErrorCode } from "./webhook-processing.service.js";
import { refreshSyncProgress } from "../whatsapp-onboarding/sync-request.service.js";
import { processTemplateStatus } from "../whatsapp-templates/template-status.service.js";

const WEBHOOK_QUEUE = "whatsapp-official-webhook";

export const processEvent = async (id: string) => {
  const leaseToken = randomUUID();
  const event = await repo.claim(id, leaseToken, new Date());
  if (!event) return;
  try {
    if (event.field === "message_template_status_update") {
      const connections = await repo.templateConnections(event.wabaId, event.organizationId);
      if (!connections.length) { await repo.finish(id, leaseToken, "unresolved", "OFFICIAL_CONNECTION_UNRESOLVED"); return; }
      for (const connection of connections) await processTemplateStatus(event, connection);
      await repo.finish(id, leaseToken, "processed", undefined, { results: [{ path: "template", status: "processed" }], syncDetails: [] });
      return;
    }
    const connection = await repo.resolveConnection(event.wabaId, event.phoneNumberId ?? undefined);
    if (!connection || (event.organizationId && event.organizationId !== connection.organizationId) || (event.connectionId && event.connectionId !== connection.id)) {
      await repo.finish(id, leaseToken, "unresolved", "OFFICIAL_CONNECTION_UNRESOLVED");
      return;
    }
    await repo.attachConnection(id, leaseToken, connection.organizationId, connection.id);
    if (connection.status === "disabled") throw conflict("OFFICIAL_CONNECTION_DISABLED", "A conexão foi desativada");
    const outcome = await processChange(event, connection);
    const failure = outcome.results.find(item => item.status === "failed");
    await repo.finish(id, leaseToken, failure ? "failed" : "processed", failure?.code, outcome);
    await refreshSyncProgress(connection.organizationId, connection.id);
  } catch (error) {
    // Somente códigos escritos pela aplicação; erros do ORM e conteúdo privado não vão ao log.
    const code = safeErrorCode(error);
    await repo.finish(id, leaseToken, ["OFFICIAL_PAYLOAD_UNSUPPORTED", "OFFICIAL_FIELD_UNSUPPORTED"].includes(code) ? "unsupported" : "failed", code);
  }
};

export const dispatchDueEvents = async () => {
  const events = await repo.dueEvents(new Date());
  for (const event of events) await enqueue(WEBHOOK_QUEUE, { id: event.id }, { jobId: event.id, removeOnComplete: true, removeOnFail: true });
  return events.length;
};
export const scheduleOfficialWebhookRecovery = () => {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void dispatchDueEvents().catch(() => {}).finally(() => { running = false; });
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
};

const webhookWorker = createWorker<{ id: string }>(WEBHOOK_QUEUE, async job => processEvent(job.data.id), 5);
// BullMQ emite `error` fora do job; não deixa um erro do Redis escapar como exceção sem handler.
webhookWorker?.on("error", () => {});
export const closeOfficialWebhookWorkers = async () => { await webhookWorker?.close(); };

const requireManager = async (orgId: string, userId: string) => {
  if (!await isOrgManager(orgId, userId)) throw forbidden("Somente gestores podem consultar eventos da integração");
};
export const listEvents = async (orgId: string, userId: string, query: Parameters<typeof repo.list>[1]) => { await requireManager(orgId, userId); return repo.list(orgId, query); };
export const replayEvent = async (orgId: string, userId: string, id: string, actor: Actor) => {
  await requireManager(orgId, userId);
  const event = await repo.findPublic(orgId, id);
  if (!event) throw notFound("Evento não encontrado nesta imobiliária");
  if (!await repo.reset(orgId, id, actor)) throw conflict("OFFICIAL_EVENT_NOT_REPLAYABLE", "O evento está em andamento ou já foi processado");
  // O journal já confirma a intenção; indisponibilidade do Redis fica para a recuperação.
  try { await enqueue(WEBHOOK_QUEUE, { id }, { jobId: id, removeOnComplete: true, removeOnFail: true }); } catch { /* A recuperação consulta o Postgres. */ }
  return repo.findPublic(orgId, id);
};
