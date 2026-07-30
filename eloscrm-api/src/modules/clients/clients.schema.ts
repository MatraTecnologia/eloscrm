import * as z from "zod";
import { ClientSource, LeadTemperature, NurtureReason } from "../../generated/prisma/client.js";

export const createClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.enum(ClientSource).optional(),
  notes: z.string().optional(),
  ownerId: z.string().optional(),
  description: z.string().optional(),
  // trim + descarte de vazias evita tag fantasma vinda de vírgula solta no formulário
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  temperature: z.enum(LeadTemperature).optional(),
  interestType: z.string().optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
});

export const updateClientSchema = createClientSchema.partial().extend({
  // undefined é "campo não enviado no PATCH"; null é "limpar o campo" e o diffFields já conta como mudança
  description: z.string().nullable().optional(),
  interestType: z.string().nullable().optional(),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  // reagendar a retomada é PATCH; entrar e sair da nutrição é POST /nurture e /reactivate. `status`
  // e `nurturedAt` ficam fora de propósito — o Zod descarta em silêncio e não existe caminho que
  // mude o estado do lead sem passar pela regra dos negócios abertos.
  nurtureReason: z.enum(NurtureReason).nullable().optional(),
  nurtureNote: z.string().nullable().optional(),
  nurtureUntil: z.coerce.date().nullable().optional(),
});

export const listClientsQuerySchema = z.object({
  source: z.enum(ClientSource).optional(),
  ownerId: z.string().optional(),
  q: z.string().optional(),
  temperature: z.enum(LeadTemperature).optional(),
  tag: z.string().optional(),
  // default ACTIVE: a listagem é a lista de trabalho e o lead em nutrição não pertence a ela
  status: z.enum(["ACTIVE", "NURTURING", "ALL"]).default("ACTIVE"),
  // z.coerce.boolean() leria a string "false" como true — todo mundo viraria vencido
  overdue: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
