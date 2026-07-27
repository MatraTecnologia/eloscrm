import * as z from "zod";

export const listAgendaQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListAgendaQuery = z.infer<typeof listAgendaQuerySchema>;
