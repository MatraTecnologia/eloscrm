import * as z from "zod";

export const remoteId = z.string().regex(/^\d{1,40}$/);
export const attemptParamsSchema = z.strictObject({ id: z.uuid() });
export const emptyBodySchema = z.strictObject({});
export const exchangeBodySchema = z.strictObject({ code: z.string().min(1).max(4096), wabaId: remoteId });
export const activateBodySchema = z.strictObject({ phoneNumberId: remoteId });
export const tokenSchema = z.object({ access_token: z.string().min(1).max(4096) });
export const debugSchema = z.object({ data: z.object({
  app_id: remoteId, is_valid: z.boolean(), expires_at: z.number().int().nonnegative(),
  data_access_expires_at: z.number().int().nonnegative().optional(),
  scopes: z.array(z.string()), granular_scopes: z.array(z.object({ scope: z.string(), target_ids: z.array(remoteId).optional() })),
}) });
export const wabaSchema = z.object({
  id: remoteId,
  currency: z.string().regex(/^[A-Z]{3}$/).nullish().transform(value => value ?? null),
  timezone_id: z.union([remoteId, z.number().int().nonnegative()]).nullish().transform(value => value == null ? null : String(value)),
  owner_business_info: z.object({ id: remoteId }),
});
export const phoneSchema = z.object({ id: remoteId, display_phone_number: z.string().max(40), verified_name: z.string().max(200).optional(), is_on_biz_app: z.boolean(), platform_type: z.string() });
export const phonePageSchema = z.object({ data: z.array(phoneSchema) });
export const candidatesSchema = z.array(phoneSchema);
export const subscriptionsSchema = z.object({ data: z.array(z.object({ object: z.string(), active: z.boolean().optional(), callback_url: z.string().optional(), fields: z.array(z.object({ name: z.string() })).optional() })) });
export const syncResponseSchema = z.object({ request_id: z.string().min(1).max(256) });
export type PhoneCandidate = z.infer<typeof phoneSchema>;
