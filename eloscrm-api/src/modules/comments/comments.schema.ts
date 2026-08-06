import * as z from "zod";
import { ANNOTATABLE_ENTITIES } from "../../lib/entity-scopes.js";

// trim antes do min: um corpo só de espaços é comentário vazio, não comentário de um caractere
export const createCommentSchema = z.object({
  entityType: z.enum(ANNOTATABLE_ENTITIES),
  entityId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const listCommentsQuerySchema = z.object({
  entityType: z.enum(ANNOTATABLE_ENTITIES),
  entityId: z.string().min(1),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
