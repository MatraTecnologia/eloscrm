import * as z from "zod";
export const groupIdSchema = z.string().min(1).max(200).regex(/^(client|contact|conversation):[a-zA-Z0-9_-]+$/);
export const paramsSchema = z.strictObject({ id: groupIdSchema });
export const listSchema = z.strictObject({ q: z.string().trim().max(200).optional(), filter: z.enum(["all", "unread", "archived"]).default("all"), clientId: z.string().min(1).max(128).optional(), cursor: z.string().max(1000).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
export const messagesSchema = z.strictObject({ q: z.string().trim().min(1).max(200).optional(), before: z.string().min(1).max(128).optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });
export const cursorSchema = z.strictObject({ id: groupIdSchema, at: z.iso.datetime() });
export const linkSchema = z.strictObject({ clientId: z.string().min(1).max(128) });
export type ListInput = z.infer<typeof listSchema>;
