import { createWorker, enqueue } from "../../lib/queue.js";
import * as repo from "./inbound-automation.repo.js";

export const AUTOMATION_QUEUE = "whatsapp-inbound-automation";
type Job = { organizationId: string; messageId: string };
export const processInboundAutomation = async (job: Job) => {
  try { await repo.process(job.organizationId, job.messageId); }
  catch { await repo.failed(job.organizationId, job.messageId); }
};
createWorker<Job>(AUTOMATION_QUEUE, async job => processInboundAutomation(job.data));
export const enqueueInboundAutomation = (job: Job) => enqueue(AUTOMATION_QUEUE, job, { attempts: 1 });
export const recoverInboundAutomation = async () => {
  for (const row of await repo.due()) await enqueueInboundAutomation({ organizationId: row.organizationId, messageId: row.id }).catch(() => undefined);
};
export const scheduleInboundAutomationRecovery = () => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await recoverInboundAutomation(); } catch { /* A intenção persiste para o próximo ciclo. */ } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref(); void tick();
  return () => clearInterval(timer);
};
