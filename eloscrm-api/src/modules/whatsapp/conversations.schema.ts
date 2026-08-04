import * as z from "zod";

export const listConversationsQuerySchema = z.object({
  // usado pela aba Conversa na ficha do lead
  clientId: z.string().optional(),
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

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  // id da NOSSA mensagem (cuid), não o do provedor: o serviço resolve o `replyid` a partir dele e,
  // no caminho, confere que a citada é da mesma conversa
  replyToId: z.string().min(1).optional(),
});

export const reactSchema = z.object({
  // vazio remove a reação — é assim que a uazapi modela o "desreagir"
  emoji: z.string().trim().max(16),
});

export const createClientFromConversationSchema = z.object({
  // o nome do perfil do WhatsApp é sugestão; o corretor pode corrigir antes de criar
  name: z.string().trim().min(1).max(120),
});

export const linkClientSchema = z.object({
  clientId: z.string().min(1),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ReactInput = z.infer<typeof reactSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
