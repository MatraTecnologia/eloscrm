import * as z from "zod";
import type { ChannelConnection, OfficialWebhookEvent } from "../../generated/prisma/client.js";
import { conflict } from "../../lib/http-error.js";
import { objectOf, objectsOf, stringOf } from "./webhook.schema.js";
import { ingestMessage } from "./ingest.repo.js";
import { ingestReceipt } from "./receipts.repo.js";
import { ingestContactSync, ingestIdentityUpdate } from "./sync.repo.js";

export type ItemResult = { path: string; status: "processed" | "failed"; code?: string };
export const safeErrorCode = (error: unknown) => {
  if (error instanceof Error && "expose" in error && error.expose === true && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error && error.name === "ZodError" ? "OFFICIAL_ITEM_INVALID" : "OFFICIAL_PROCESSING_FAILED";
};

export const processChange = async (event: OfficialWebhookEvent, connection: ChannelConnection) => {
  const value = objectOf(event.payload);
  const results: ItemResult[] = [];
  const syncDetails: Record<string, unknown>[] = [];
  const each = async (raw: unknown, path: string, process: (item: Record<string, unknown>, path: string) => Promise<unknown>, recordSuccess = true) => {
    const array = z.array(z.unknown()).safeParse(raw);
    if (!array.success) { results.push({ path, status: "failed", code: "OFFICIAL_ITEM_INVALID" }); return; }
    for (const [index, item] of array.data.entries()) {
      const itemPath = `${path}[${index}]`;
      try {
        await process(objectOf(item), itemPath);
        if (recordSuccess) results.push({ path: itemPath, status: "processed" });
      } catch (error) { results.push({ path: itemPath, status: "failed", code: safeErrorCode(error) }); }
    }
  };
  const contacts = () => objectsOf(value.contacts);
  if (event.field === "messages") {
    if (value.messages !== undefined) await each(value.messages, "messages", item => ingestMessage(connection, item, contacts(), "cloud_api", event.receivedAt));
    if (value.statuses !== undefined) await each(value.statuses, "statuses", item => ingestReceipt(connection, item, event.receivedAt));
    if (value.messages === undefined && value.statuses === undefined) throw conflict("OFFICIAL_PAYLOAD_UNSUPPORTED", "O evento não contém mensagens ou estados reconhecidos");
  } else if (event.field === "smb_message_echoes") {
    await each(value.message_echoes, "message_echoes", item => ingestMessage(connection, item, contacts(), "business_app", event.receivedAt));
  } else if (event.field === "history") {
    await each(value.history, "history", async (batch, batchPath) => {
      if (batch.errors) {
        if (!objectsOf(batch.errors).every(error => error.code === 2593109)) throw conflict("OFFICIAL_HISTORY_FAILED", "A sincronização do histórico retornou erro");
        syncDetails.push({ historySharing: "declined" });
        results.push({ path: batchPath, status: "processed" });
        return;
      }
      if (batch.metadata) {
        const metadata = z.object({ phase: z.number().int().min(0).max(2), chunk_order: z.number().int().nonnegative(), progress: z.number().min(0).max(100) }).safeParse(batch.metadata);
        if (metadata.success) syncDetails.push({ phase: metadata.data.phase, chunkOrder: metadata.data.chunk_order, progress: metadata.data.progress });
      }
      await each(batch.threads ?? [], `${batchPath}.threads`, async (thread, threadPath) => {
        const threadId = stringOf(thread.id);
        if (!threadId) throw conflict("OFFICIAL_PAYLOAD_UNSUPPORTED", "O histórico não possui destinatário reconhecido");
        await each(thread.messages, `${threadPath}.messages`, item => ingestMessage(connection, item, [], "history", event.receivedAt, threadId));
      }, false);
    }, false);
  } else if (event.field === "smb_app_state_sync") {
    await each(value.state_sync, "state_sync", item => ingestContactSync(connection, item));
  } else if (event.field === "user_id_update") {
    await each(value.user_id_update, "user_id_update", item => ingestIdentityUpdate(connection, item, event.receivedAt));
  } else throw conflict("OFFICIAL_FIELD_UNSUPPORTED", "Evento oficial ainda não suportado");
  return { results, syncDetails };
};
