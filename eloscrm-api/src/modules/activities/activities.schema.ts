import * as z from "zod";
import { ActivityType } from "../../generated/prisma/client.js";

export const createActivitySchema = z.object({
  type: z.enum(ActivityType),
  description: z.string().min(1),
  // nullable nos vínculos: o formulário manda `null` quando o usuário escolhe "sem vínculo", e
  // exigir a omissão do campo obrigaria o cliente a montar payloads diferentes para criar e editar
  clientId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  dueAt: z.coerce.date().optional(),
  doneAt: z.coerce.date().optional(),
});

// Não é `createActivitySchema.partial()`: `.partial()` só torna os campos opcionais, e
// `z.coerce.date()` aceita `null` fazendo `new Date(null)` — gravaria 1970-01-01 sem erro.
// `null` aqui é intencional e significa limpar o campo (desmarcar concluída, tirar da agenda,
// desvincular do cliente/negócio).
export const updateActivitySchema = z.object({
  type: z.enum(ActivityType).optional(),
  description: z.string().min(1).optional(),
  clientId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  doneAt: z.coerce.date().nullable().optional(),
});

export const listActivitiesQuerySchema = z.object({
  clientId: z.string().optional(),
  dealId: z.string().optional(),
  type: z.enum(ActivityType).optional(),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
