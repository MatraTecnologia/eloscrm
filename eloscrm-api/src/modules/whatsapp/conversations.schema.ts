import * as z from "zod";

export const listConversationsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  unread: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  // id da mensagem mais antiga já carregada: paginação para trás, como toda thread de conversa
  before: z.string().optional(),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
