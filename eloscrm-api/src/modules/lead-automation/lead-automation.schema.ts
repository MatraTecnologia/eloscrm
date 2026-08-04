import * as z from "zod";

export const updateLeadAutomationSchema = z.object({
  autoCreateClient: z.boolean(),

  autoCreateDeal: z.boolean(),
  // nulo é estado real: a chave pode estar desligada e o funil ainda não escolhido
  pipelineId: z.string().min(1).nullable(),
  stageId: z.string().min(1).nullable(),

  autoAssign: z.boolean(),
  // ids dos usuários que participam da roleta; quem não está na lista não recebe
  memberUserIds: z.array(z.string().min(1)).max(200),
});

export type UpdateLeadAutomationInput = z.infer<typeof updateLeadAutomationSchema>;
