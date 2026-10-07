import { createWorker } from "../../lib/queue.js";

export const MESSAGE_QUEUE = "whatsapp-message";

export type MessageJob = {
  instanceId: string;
  organizationId: string;
  body: Record<string, unknown>;
};

// Consome jobs antigos sem criar conversas, mensagens, mídia ou leads.
export const processMessageEvent = async (_job: MessageJob) => ({ skipped: true as const });

createWorker<MessageJob>(MESSAGE_QUEUE, async job => processMessageEvent(job.data));
