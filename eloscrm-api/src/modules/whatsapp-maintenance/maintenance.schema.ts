import * as z from "zod";

export const historySchema = z.strictObject({ apply: z.boolean().default(false), cursor: z.string().min(1).max(128).optional() });
export const retentionSchema = z.strictObject({ apply: z.boolean().default(false) });
export const disableSchema = z.strictObject({ confirm: z.literal("DISABLE_LOCAL") });
