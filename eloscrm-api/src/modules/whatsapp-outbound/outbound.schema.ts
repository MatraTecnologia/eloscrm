import * as z from "zod";

export const paramsSchema = z.strictObject({ connectionId: z.string().min(1).max(128) });
export const commandParamsSchema = z.strictObject({ id: z.string().uuid() });
const valuesSchema = z.record(z.string().min(1).max(64), z.string().min(1).max(1024)).refine(values => Object.keys(values).length <= 30);
const common = { idempotencyKey: z.string().min(8).max(128), identityId: z.string().min(1).max(128), quotedMessageId: z.string().min(1).max(128).optional() };
export const sendSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("text"), text: z.string().trim().min(1).max(4096) }),
  z.strictObject({ ...common, type: z.literal("template"), templateId: z.string().min(1).max(128), headerUploadId: z.string().uuid().optional(), parameters: z.strictObject({ header: valuesSchema.default({}), body: valuesSchema.default({}), buttons: z.record(z.string().regex(/^[0-9]$/), z.string().regex(/^[A-Za-z0-9._~-]{1,256}$/)).optional() }) }),
  z.strictObject({ ...common, type: z.literal("media"), uploadId: z.string().uuid(), caption: z.string().max(1024).optional() }),
]);
export type SendInput = z.infer<typeof sendSchema>;
export const templateSchema = z.looseObject({
  id: z.string().regex(/^\d+$/), name: z.string().min(1).max(512), language: z.string().min(1).max(32), category: z.string().max(64), status: z.string().max(64),
  parameter_format: z.enum(["NAMED", "POSITIONAL"]).optional(),
  components: z.array(z.looseObject({ type: z.string(), format: z.string().optional(), text: z.string().optional(), buttons: z.array(z.looseObject({ type: z.string(), url: z.string().optional() })).optional() })).max(20),
});
export type TemplateDefinition = z.infer<typeof templateSchema>;
export const sendResponseSchema = z.looseObject({ messages: z.array(z.looseObject({ id: z.string().min(1).max(256) })).length(1) });
