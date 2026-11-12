import { randomUUID } from "node:crypto";
import { createWorker, enqueue } from "../../lib/queue.js";
import * as repo from "./webhook.repo.js";
import { hubEnvelopeSchema } from "./webhook.schema.js";
import { hubHandlers } from "./webhook.handlers.js";

const WEBHOOK_QUEUE = "meta-hub-webhook";

const handledTypes = () => [...hubHandlers.keys()];

// Só códigos escritos pela aplicação vão para o journal; erro do ORM pode trazer conteúdo privado.
const safeCode = (error: unknown) => error && typeof error === "object" && "expose" in error && "code" in error && typeof error.code === "string" ? error.code : "HUB_EVENT_FAILED";

export const processEvent = async (id: string) => {
  const leaseToken = randomUUID();
  const event = await repo.claim(id, handledTypes(), leaseToken, new Date());
  if (!event) return;
  try {
    const envelope = hubEnvelopeSchema.parse(event.payload);
    // o workspace ou a conexão podem ter sido ligados depois da captura
    const tenant = await repo.resolveTenant(envelope.workspace, envelope.connectionId);
    if (tenant.status === "unresolved") { await repo.finish(id, leaseToken, "unresolved", tenant.lastErrorCode); return; }
    await repo.attachTenant(id, leaseToken, tenant);
    const result = await hubHandlers.get(event.type)!(envelope, event, { ...tenant, organizationId: tenant.organizationId! });
    await repo.finish(id, leaseToken, result.status, result.code ?? null);
  } catch (error) {
    await repo.finish(id, leaseToken, "failed", safeCode(error));
  }
};

export const dispatchDueEvents = async () => {
  const events = await repo.dueEvents(new Date(), handledTypes());
  for (const event of events) await enqueue(WEBHOOK_QUEUE, { id: event.id }, { jobId: event.id, removeOnComplete: true, removeOnFail: true });
  return events.length;
};

// Lê só o banco local: roda sempre, mesmo sem HUB_JOBS_ENABLED, porque é ela que processa o journal
// quando não há Redis e que retoma o que ficou para trás.
export const scheduleHubWebhookSweep = () => {
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
