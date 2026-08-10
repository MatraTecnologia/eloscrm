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

export const pinSchema = z.object({
  pin: z.boolean(),
  // o provedor só aceita 1, 7 ou 30 dias; qualquer outro valor ele troca por 30 em silêncio
  duration: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(30),
});

export const favoriteSchema = z.object({
  favorite: z.boolean(),
});

export const createClientFromConversationSchema = z.object({
  // o nome do perfil do WhatsApp é sugestão; o corretor pode corrigir antes de criar
  name: z.string().trim().min(1).max(120),
});

export const linkClientSchema = z.object({
  clientId: z.string().min(1),
});

/**
 * O que a imobiliária pode mandar pelo WhatsApp.
 *
 * A allowlist é por content-type e mais larga que a dos anexos porque aqui o destino é uma conversa,
 * não o dossiê do lead: foto de imóvel, vídeo do apartamento e áudio fazem parte do atendimento. Só
 * barra o que o cliente **pede** no upload-url — o content-type não entra na assinatura do presign,
 * então quem confere o arquivo que de fato chegou é o HEAD no envio, como nos anexos.
 *
 * `image/gif` fica de fora de propósito: o WhatsApp trata gif como vídeo mp4 (§2.5 do spec de
 * conversas), e mandar o gif original produziria uma bolha que não toca.
 */
export const WHATSAPP_MEDIA_TYPES = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/mp4": "audio",
  "application/pdf": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
} as const;

export type WhatsappMediaContentType = keyof typeof WHATSAPP_MEDIA_TYPES;

/**
 * A spec da uazapi não declara limite de tamanho (`paths/enviar-mensagem/send_media.yaml` só
 * descreve os tipos), então quem manda é o teto do próprio WhatsApp: 16 MB para o que toca ou
 * aparece na conversa, e bem mais para documento — a planta em PDF de um apartamento passa fácil
 * dos 16. O download de entrada aceita até 100 MB (`MAX_MEDIA_BYTES`); aqui o teto é menor porque
 * um envio recusado pelo WhatsApp depois do upload seria trabalho perdido para o corretor.
 */
export const MAX_SEND_MEDIA_BYTES = 16 * 1024 * 1024;
export const MAX_SEND_DOCUMENT_BYTES = 64 * 1024 * 1024;

export const maxBytesFor = (contentType: WhatsappMediaContentType) =>
  WHATSAPP_MEDIA_TYPES[contentType] === "document"
    ? MAX_SEND_DOCUMENT_BYTES
    : MAX_SEND_MEDIA_BYTES;

export const mediaUploadUrlSchema = z
  .object({
    filename: z.string().trim().min(1).max(200),
    contentType: z.enum(
      Object.keys(WHATSAPP_MEDIA_TYPES) as [WhatsappMediaContentType, ...WhatsappMediaContentType[]],
    ),
    size: z.number().int().positive(),
  })
  .refine((data) => data.size <= maxBytesFor(data.contentType), {
    message: "Arquivo grande demais para o WhatsApp",
    path: ["size"],
  });

export const sendMediaSchema = z.object({
  // a chave devolvida pelo upload-url; o serviço confere que ela pertence a esta conversa
  key: z.string().min(1).max(500),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(
    Object.keys(WHATSAPP_MEDIA_TYPES) as [WhatsappMediaContentType, ...WhatsappMediaContentType[]],
  ),
  caption: z.string().trim().max(4096).optional(),
  replyToId: z.string().min(1).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MediaUploadUrlInput = z.infer<typeof mediaUploadUrlSchema>;
export type SendMediaInput = z.infer<typeof sendMediaSchema>;
export type ReactInput = z.infer<typeof reactSchema>;
export type PinInput = z.infer<typeof pinSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
