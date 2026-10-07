import * as z from "zod";

const remoteId = z.string().trim().regex(/^\d{1,40}$/);

// Contrato interno: o onboarding deve validar os ativos na Meta antes de persistir.
export const verifiedOfficialConnectionSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  businessPortfolioId: remoteId,
  wabaId: remoteId,
  phoneNumberId: remoteId,
  accessToken: z.string().trim().min(1).max(4096),
  tokenExpiresAt: z.date().nullable().default(null),
  displayPhoneNumber: z.string().trim().max(40).nullable().default(null),
  verifiedName: z.string().trim().max(200).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezoneId: remoteId,
  isOnBusinessApp: z.boolean(),
});

export const connectionParamsSchema = z.strictObject({ id: z.string().min(1).max(128) });
export type VerifiedOfficialConnectionInput = z.input<typeof verifiedOfficialConnectionSchema>;
