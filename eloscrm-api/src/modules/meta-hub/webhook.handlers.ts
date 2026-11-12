import { WEBHOOK_ACTOR } from "../../lib/actor.js";
import type { HubWebhookEvent } from "../../generated/prisma/client.js";
import type { HubTenant } from "./webhook.repo.js";
import type { HubEnvelope } from "./webhook.schema.js";
import { applyHubConnection } from "./connection.service.js";

export type HubHandlerResult = { status: "processed" | "unsupported" | "failed"; code?: string };
export type HubHandler = (envelope: HubEnvelope, event: HubWebhookEvent, tenant: HubTenant & { organizationId: string }) => Promise<HubHandlerResult>;

// data é a conexão no formato do GET (hub:1204); id diferente do envelope não é desta conexão
const connectionHandler: HubHandler = async (envelope, _event, tenant) => {
  const data = envelope.data;
  if (!data || typeof data !== "object" || !("id" in data) || data.id !== envelope.connectionId) return { status: "failed", code: "HUB_CONNECTION_MISMATCH" };
  const outcome = await applyHubConnection(tenant.organizationId, data, { meta: envelope.meta, actor: WEBHOOK_ACTOR });
  return { status: outcome.status, code: outcome.code };
};

// Tipo sem handler nesta imagem fica `pending` no journal até uma imagem que o trate (D6).
export const hubHandlers = new Map<string, HubHandler>([
  ["connection.created", connectionHandler],
  ["connection.updated", connectionHandler],
  ["connection.disconnected", connectionHandler],
  ["connection.token_expiring", connectionHandler],
]);
