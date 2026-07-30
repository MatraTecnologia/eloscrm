import * as z from "zod";
import { NurtureReason } from "../../generated/prisma/client.js";

// `deals` é a decisão explícita sobre cada negócio aberto do lead. Omitido = lead sem negócio aberto;
// a validação de cobertura fica no service, que é quem sabe quais negócios existem.
const dealDecisionSchema = z.object({
  dealId: z.string().min(1),
  action: z.enum(["KEEP", "CLOSE_LOST"]),
  lostStageId: z.string().min(1).optional(),
});

export const nurtureSchema = z.object({
  reason: z.enum(NurtureReason),
  note: z.string().min(1).optional(),
  until: z.coerce.date().optional(),
  deals: z.array(dealDecisionSchema).max(50).optional(),
});

export const reactivateSchema = z.object({
  reopenDealIds: z.array(z.string().min(1)).max(50).optional(),
});

export type NurtureInput = z.infer<typeof nurtureSchema>;
export type ReactivateInput = z.infer<typeof reactivateSchema>;
export type DealDecision = z.infer<typeof dealDecisionSchema>;
