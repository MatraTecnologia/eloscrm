import * as z from "zod";
import type { Actor } from "../../lib/actor.js";
import { instanceClient, requireIntegration } from "../whatsapp/whatsapp.gateway.js";
import { resolveManualRoute } from "./uazapi-policy.repo.js";
import * as repo from "./uazapi-manual.repo.js";

export const manualSendSchema = z.strictObject({ text: z.string().trim().min(1).max(4096), idempotencyKey: z.string().uuid(), confirmManualException: z.literal(true) });

export const send = async (orgId: string, conversationId: string, raw: z.infer<typeof manualSendSchema>, actor: Actor) => {
  const input = manualSendSchema.parse(raw);
  const route = await resolveManualRoute(orgId, conversationId);
  const client = instanceClient(requireIntegration(), route.instance.tokenEnc);
  const reserved = await repo.reserve(orgId, conversationId, route.connection.id, input, actor);
  if (!reserved.created) return repo.resultOf(reserved.message);
  let submitting = false;
  try {
    // Confere novamente a rota antes da submissão; não aceita um destino enviado pelo navegador.
    const current = await resolveManualRoute(orgId, conversationId);
    if (current.instance.id !== route.instance.id || current.destination !== route.destination) return repo.resultOf(await repo.settle(orgId, reserved.message.id, { status: "failed" }, actor));
    submitting = true;
    const result = await client.send.text({ number: route.destination, text: input.text, track_source: "eloscrm_manual", track_id: reserved.message.id });
    if (!result.success) return repo.resultOf(await repo.settle(orgId, reserved.message.id, { status: result.error.status >= 500 || result.error.error_source === "network" || result.error.error_source === "timeout" ? "pending" : "failed" }, actor));
    const providerMessageId = result.data.messageid;
    if (!providerMessageId) return repo.resultOf(reserved.message);
    return repo.resultOf(await repo.settle(orgId, reserved.message.id, { status: "sent", providerMessageId }, actor));
  } catch {
    // A intenção já foi gravada. Uma nova consulta à mesma chave nunca repete a chamada ao provedor.
    return submitting ? repo.resultOf(reserved.message) : repo.resultOf(await repo.settle(orgId, reserved.message.id, { status: "failed" }, actor));
  }
};
