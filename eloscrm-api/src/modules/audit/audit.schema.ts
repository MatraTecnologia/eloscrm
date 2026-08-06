import * as z from "zod";
import { AuditAction, AuditEntity, AuditSource } from "../../generated/prisma/client.js";

/** Aceita `?action=CREATED&action=DELETED` e `?action=CREATED,DELETED` — a tela filtra por vários. */
const multi = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      const lista = Array.isArray(value) ? value : String(value).split(",");
      return lista.map((item) => String(item).trim()).filter(Boolean);
    },
    z.array(schema).min(1).optional(),
  );

export const listAuditQuerySchema = z
  .object({
    entityType: multi(z.enum(AuditEntity)),
    // presente = histórico de UMA entidade (qualquer membro); ausente = busca global (só gestor)
    entityId: z.string().min(1).optional(),
    action: multi(z.enum(AuditAction)),
    actorId: z.string().min(1).optional(),
    source: z.enum(AuditSource).optional(),
    /**
     * Agrupa os eventos nascidos da mesma chamada (transferência em lote, por exemplo) — é o que o
     * detalhe usa em "ver as N ações desta mesma operação".
     */
    requestId: z.string().min(1).optional(),
    // casa em entityLabel, actorName e entityId: é o que o gestor tem na mão
    q: z.string().trim().min(1).max(120).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "O início do período não pode ser depois do fim",
    path: ["from"],
  });

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
