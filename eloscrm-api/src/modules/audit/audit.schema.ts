import * as z from "zod";
import { AuditEntity } from "../../generated/prisma/client.js";

export const listAuditQuerySchema = z.object({
  entityType: z.enum(AuditEntity),
  entityId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
