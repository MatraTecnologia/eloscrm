import * as z from "zod";

const id = z.string().min(1).max(256);

// Tolerante de propósito: campo novo e valor novo chegam sem aviso além do changelog (hub:1690).
// Só o que decide dedup, ordem e tenant é exigido.
export const hubEnvelopeSchema = z.looseObject({
  id,
  type: z.string().min(1).max(128),
  createdAt: z.iso.datetime({ offset: true }),
  workspace: z.looseObject({ id, externalId: z.string().max(256).nullish() }),
  connectionId: id.nullish(),
  data: z.unknown(),
  meta: z.unknown().optional(),
});
export type HubEnvelope = z.infer<typeof hubEnvelopeSchema>;

// Catálogo de eventos (hub:1184-1198). Tipo fora dele, Lead Ads e conexão que não é de WhatsApp
// não são deste app e ficam `unsupported` sem passar pela resolução de tenant (§5.2 do plano).
const WHATSAPP_TYPES = new Set([
  "connection.created", "connection.updated", "connection.disconnected", "connection.token_expiring",
  "whatsapp.message.received", "whatsapp.message.status", "whatsapp.message.echo",
  "whatsapp.history.received", "whatsapp.contacts.synced", "whatsapp.identity.updated", "whatsapp.media.updated",
  "whatsapp.template.status_updated", "whatsapp.template.updated", "whatsapp.usage.free_tier",
]);

export const isSupportedEnvelope = (envelope: HubEnvelope) => {
  if (!WHATSAPP_TYPES.has(envelope.type)) return false;
  if (!envelope.type.startsWith("connection.")) return true;
  const data = envelope.data;
  return Boolean(data && typeof data === "object" && "kind" in data && data.kind === "whatsapp");
};
