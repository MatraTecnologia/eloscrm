import * as z from "zod";
import { broadcastFiltersSchema } from "../broadcasts/broadcasts.schema.js";
import { importedAudienceSchema } from "../campaign-imports/imports.schema.js";

const values = z.record(z.string().min(1).max(64), z.string().trim().min(1).max(1024)).refine(value => Object.keys(value).length <= 30);
export const parametersSchema = z.strictObject({ header: values.default({}), body: values.default({}), buttons: z.record(z.string().regex(/^[0-9]$/), z.string().regex(/^[A-Za-z0-9._~-]{1,256}$/)).optional() });
const sources = z.record(z.string().min(1).max(64), z.enum(["firstName", "fullName", "dealTitle", "dealValue", "propertyTitle", "ownerName"])).refine(value => Object.keys(value).length <= 30);
export const parameterSourcesSchema = z.strictObject({ header: sources.default({}), body: sources.default({}) });
export const campaignInputSchema = z.strictObject({
  connectionId: z.string().min(1).max(128), pipelineId: z.string().min(1).max(128),
  filters: broadcastFiltersSchema.safeExtend({}).strict().default({}),
  dealIds: z.array(z.string().min(1).max(128)).max(200).transform(ids => [...new Set(ids)].sort()).default([]),
  importedAudience: importedAudienceSchema.optional(),
  templateId: z.string().min(1).max(128), headerUploadId: z.string().uuid().optional(), parameters: parametersSchema,
  parameterSources: parameterSourcesSchema.optional(),
}).refine(value => value.importedAudience ? value.dealIds.length === 0 : value.dealIds.length > 0, "Selecione negócios ou uma lista importada, sem misturar os públicos");
export const createSchema = campaignInputSchema.safeExtend({ name: z.string().trim().min(1).max(120), idempotencyKey: z.string().uuid(), previewHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const approvalSchema = z.strictObject({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const permissionSchema = z.strictObject({ state: z.enum(["allowed", "suppressed"]), evidence: z.string().trim().min(3).max(500) });
export const idSchema = z.strictObject({ id: z.string().uuid() });
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type CreateInput = z.infer<typeof createSchema>;
