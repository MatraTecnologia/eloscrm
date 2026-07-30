import * as z from "zod";
import { AuditEntity } from "../../generated/prisma/client.js";

export const MAX_SIZE_BYTES = 20 * 1024 * 1024;

// allowlist em vez de bloqueio por extensão: o navegador manda o content-type e é ele que assinamos
export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const uploadUrlSchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_SIZE_BYTES),
});

export const listAttachmentsQuerySchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
