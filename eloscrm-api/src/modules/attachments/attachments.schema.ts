import * as z from "zod";
import { ANNOTATABLE_ENTITIES } from "../../lib/entity-scopes.js";

export const MAX_SIZE_BYTES = 20 * 1024 * 1024;

// allowlist em vez de bloqueio por extensão. Isto só barra o que o cliente *pede* no upload-url:
// o content-type não entra na assinatura do presign (o SDK o marca como unsignable), então o browser
// pode subir qualquer coisa na URL assinada. A conferência do arquivo que de fato chegou é no confirm.
export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const uploadUrlSchema = z.object({
  entityType: z.enum(ANNOTATABLE_ENTITIES),
  entityId: z.string().min(1),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_SIZE_BYTES),
});

export const listAttachmentsQuerySchema = z.object({
  entityType: z.enum(ANNOTATABLE_ENTITIES),
  entityId: z.string().min(1),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
