import * as z from "zod";

// nullable nos opcionais: `null` significa limpar o campo (desvincular o imóvel, tirar o
// responsável, apagar o motivo da perda, zerar o valor). Com `.optional()` sozinho o PATCH que manda
// `null` volta 422 — o campo aparece na tela e fica impossível de esvaziar.
const optionalFields = {
  propertyId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
  lostReason: z.string().nullable().optional(),
};

export const createDealSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  ...optionalFields,
});

// `.partial()` no schema de criação daria o mesmo resultado hoje, mas escrever à mão deixa explícito
// que os obrigatórios continuam recusando string vazia quando vêm — e que pipelineId, aceito aqui,
// é descartado pelo service (negócio não troca de funil).
export const updateDealSchema = z.object({
  clientId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  pipelineId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  ...optionalFields,
});

export const listDealsQuerySchema = z.object({
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;
