import * as z from "zod";
import { createHash } from "node:crypto";

export const objectSchema = z.record(z.string(), z.unknown());
export const envelopeSchema = z.looseObject({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.looseObject({
    id: z.string().regex(/^\d{1,40}$/),
    time: z.number().int().nonnegative().max(253402300799).optional(),
    changes: z.array(z.looseObject({ field: z.string().min(1).max(100), value: objectSchema })).min(1).max(1000),
  })).min(1).max(100),
});

export const objectOf = (value: unknown): Record<string, unknown> => objectSchema.parse(value);
export const objectsOf = (value: unknown) => z.array(objectSchema).parse(value ?? []);
export const stringOf = (value: unknown) => typeof value === "string" && value.length ? value : undefined;

// A ordenação das chaves impede que a mesma entrega gere journals diferentes por serialização.
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
export const eventHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export const eventParamsSchema = z.strictObject({ id: z.string().min(1).max(128) });
export const journalQuerySchema = z.strictObject({
  status: z.enum(["pending", "processing", "processed", "failed", "unresolved", "unsupported"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
