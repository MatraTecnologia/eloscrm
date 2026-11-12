import * as z from "zod";

// Conexão do hub (hub:560-616), tolerante: status, errorCode e kind novos chegam sem aviso (hub:1690).
const text = z.string().max(512);
export const hubWhatsappSchema = z.looseObject({
  wabaId: z.string().min(1).max(64),
  businessId: text.nullish(),
  phoneNumberId: z.string().min(1).max(64),
  displayPhoneNumber: text.nullish(),
  verifiedName: text.nullish(),
  isOnBizApp: z.boolean().nullish(),
  qualityRating: text.nullish(),
  currency: text.nullish(),
  timezone: text.nullish(),
});
export const hubSyncSchema = z.looseObject({
  type: z.string(),
  status: z.string(),
  progress: z.number().min(0).max(100).nullish(),
  errorCode: text.nullish(),
});
export const hubConnectionSchema = z.looseObject({
  id: z.string().min(1).max(256),
  kind: z.string(),
  status: z.string(),
  errorCode: text.nullish(),
  workspaceId: z.string().min(1).max(256),
  whatsapp: hubWhatsappSchema.nullish(),
  sync: z.array(hubSyncSchema).nullish(),
  tokenExpiresAt: z.iso.datetime({ offset: true }).nullish(),
  health: z.unknown().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type HubConnectionData = z.infer<typeof hubConnectionSchema>;

export const hubDisconnectMetaSchema = z.looseObject({ reason: z.string().optional(), accountEvent: z.string().optional() });

export const refreshParamsSchema = z.object({ id: z.string().min(1).max(256) });
export const emptyBodySchema = z.object({}).strict().nullish();
