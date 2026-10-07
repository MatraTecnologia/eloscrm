import * as z from "zod";
const id = z.string().min(1).max(128);
const decimal = z.string().regex(/^\d{1,8}(\.\d{1,10})?$/);
export const periodSchema = z.strictObject({ connectionId: id, start: z.iso.datetime(), end: z.iso.datetime() }).refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000, "Escolha um período de até 31 dias");
export type Period = z.infer<typeof periodSchema>;
const rateFields = z.strictObject({ connectionId: id, country: z.string().regex(/^[A-Z]{2}$/), category: z.string().regex(/^[A-Z_]{1,64}$/), pricingType: z.enum(["REGULAR", "FREE_CUSTOMER_SERVICE", "FREE_ENTRY_POINT"]), unitRate: decimal,
  validFrom: z.iso.datetime(), validUntil: z.iso.datetime(), volumeFrom: z.number().int().min(0).max(2000000000).default(0), volumeUntil: z.number().int().positive().max(2000000000).nullable().default(null),
  sourceUrl: z.url().max(2048).refine(value => { const url = new URL(value); return url.protocol === "https:" && ["developers.facebook.com", "business.whatsapp.com"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash; }, "Informe a página oficial da tarifa sem parâmetros"),
});
const validRate = (value: { validFrom: string; validUntil: string; volumeFrom: number; volumeUntil: number | null }) => Date.parse(value.validUntil) > Date.parse(value.validFrom) && (value.volumeUntil === null || value.volumeUntil > value.volumeFrom);
export const rateSchema = rateFields.refine(validRate);
export type RateInput = z.infer<typeof rateSchema>;
export const simulationSchema = z.strictObject({ connectionId: id, at: z.iso.datetime(), rows: z.array(z.strictObject({ country: z.string().regex(/^[A-Z]{2}$/), category: z.string().regex(/^[A-Z_]{1,64}$/), pricingType: z.enum(["REGULAR", "FREE_CUSTOMER_SERVICE", "FREE_ENTRY_POINT"]).default("REGULAR"), quantity: z.number().int().min(1).max(1000000), volumeBefore: z.number().int().min(0).max(1000000000).default(0) })).min(1).max(30) }).refine(input => new Set(input.rows.map(row => `${row.country}:${row.category}:${row.pricingType}`)).size === input.rows.length, "Agrupe volumes do mesmo mercado e categoria");
export type SimulationInput = z.infer<typeof simulationSchema>;
export const previewSchema = z.strictObject({ connectionId: id, identityId: id, type: z.enum(["text", "media", "template"]), templateId: id.optional() }).refine(input => input.type !== "template" || !!input.templateId);
export type PreviewInput = z.infer<typeof previewSchema>;

export const reportSchema = z.strictObject({ ...periodSchema.shape, contactId: id.optional(), conversationId: id.optional(), campaignId: id.optional() }).refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000, "Escolha um período de até 31 dias");
export type ReportInput = z.infer<typeof reportSchema>;
export const rateImportSchema = z.strictObject({ connectionId: id, rows: z.array(rateFields.omit({ connectionId: true }).refine(validRate)).min(1).max(100) });
export type RateImportInput = z.infer<typeof rateImportSchema>;
export const recipientCountrySchema = z.strictObject({ connectionId: id, identityId: id, country: z.string().regex(/^[A-Z]{2}$/) });
export const reconciliationSchema = z.strictObject({ ...periodSchema.shape, documentReference: z.string().trim().min(1).max(200), reportedTotal: decimal, declaredFees: decimal.optional(), declaredTaxes: decimal.optional(), note: z.string().trim().max(1000).optional() }).refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000, "Escolha um período de até 31 dias");
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
