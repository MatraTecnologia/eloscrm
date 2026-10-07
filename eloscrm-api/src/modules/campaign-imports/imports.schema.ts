import * as z from "zod";
import { toWaNumber } from "../../lib/phone.js";

export const normalizePhone = (value: string) => {
  const phone = /^[+\d\s().-]+$/.test(value.trim()) ? toWaNumber(value) : null;
  return phone && /^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(phone) ? phone : null;
};
export const importedAudienceSchema = z.strictObject({
  recipients: z.array(z.strictObject({ phone: z.string().min(1).max(40).transform(normalizePhone).refine(value => value !== null, "Telefone inválido"), name: z.string().trim().max(120).default("") })).min(1).max(200),
  consent: z.strictObject({ confirmed: z.boolean(), evidence: z.string().trim().max(500) }).optional(),
});
export type ImportedAudience = z.infer<typeof importedAudienceSchema>;
export const importFileSchema = z.strictObject({ filename: z.string().min(1).max(200), content: z.string().min(1).max(1400000).regex(/^[A-Za-z0-9+/]*={0,2}$/) });
