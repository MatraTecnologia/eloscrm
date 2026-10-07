import * as z from "zod";
import * as graph from "../../lib/whatsapp-official/graph.js";
import { decryptOfficialToken } from "../../lib/whatsapp-official/crypto.js";
import { syncResponseSchema } from "./onboarding.schema.js";
import * as repo from "./sync-request.repo.js";
import { recoverExchanges } from "./onboarding.repo.js";

export const refreshSyncProgress = async (orgId: string, connectionId: string) => {
  for (const request of await repo.requests(orgId, connectionId)) {
    if (["pending", "expired", "failed"].includes(request.status)) continue;
    const events = await repo.eventsFor(orgId, connectionId, request.syncType === "history" ? "history" : "smb_app_state_sync", request.createdAt);
    if (!events.length) continue;
    const details = events.flatMap(event => z.array(z.object({ progress: z.number().min(0).max(100).optional(), historySharing: z.literal("declined").optional() })).safeParse(event.syncDetails).data ?? []);
    const progress = Math.max(request.progress, ...details.map(detail => detail.progress ?? 0));
    const blocked = events.some(event => event.status !== "processed");
    const declined = !blocked && details.some(detail => detail.historySharing === "declined");
    // Contatos não têm marcador documentado de conclusão: recebimento não vira "completo".
    const status = declined ? "declined" : request.syncType === "history" && progress === 100 && !blocked ? "complete" : "receiving";
    await repo.setProgress(orgId, request.id, status, Math.floor(progress), blocked ? "OFFICIAL_SYNC_ITEMS_PENDING" : null);
  }
};

export const resumeConnection = async (orgId: string, connectionId: string) => {
  const connection = await repo.connection(orgId, connectionId);
  if (!connection?.tokenEnc || !connection.isOnBusinessApp || !["pending", "connected"].includes(connection.status)) return;
  if (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date()) return;
  const token = decryptOfficialToken(connection.tokenEnc, { organizationId: orgId, connectionId });
  if (connection.status === "pending") {
    try {
      z.object({ success: z.literal(true) }).parse(await graph.subscribeWaba(token, connection.wabaId!));
      if (!(await repo.activateConnection(orgId, connectionId)).count) return;
    } catch { await repo.subscriptionFailed(orgId, connectionId); return; }
  }
  for (const request of await repo.requests(orgId, connectionId)) {
    if (!await repo.claim(orgId, request.id)) continue;
    try {
      const response = syncResponseSchema.parse(await graph.requestSync(token, connection.phoneNumberId!, request.syncType));
      await repo.accepted(orgId, request.id, response.request_id);
    } catch (error) {
      // Resposta perdida ou inválida pode ocultar aceite; a API permite uma solicitação por fluxo.
      await repo.rejected(orgId, request.id, !(error instanceof graph.OfficialGraphError) || error.uncertain);
    }
  }
  await refreshSyncProgress(orgId, connectionId);
};

export const recoverOnboardings = async () => {
  await recoverExchanges();
  await repo.recoverStale();
  for (const connection of await repo.dueConnections()) {
    try { await resumeConnection(connection.organizationId, connection.id); } catch { /* A intenção permanece no Postgres. */ }
  }
  for (const request of await repo.activeSyncConnections()) await refreshSyncProgress(request.organizationId, request.connectionId);
};
export const scheduleOnboardingRecovery = () => {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverOnboardings().catch(() => {}).finally(() => { running = false; });
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
};
