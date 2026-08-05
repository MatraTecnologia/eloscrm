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
// que os obrigatórios continuam recusando string vazia quando vêm.
//
// `pipelineId` sem `stageId` é recusado aqui, e não no service, porque o estado que ele produziria é
// insalvável: o negócio ficaria apontando para um estágio de outro funil, sumiria de toda coluna do
// kanban e só apareceria como "—" nas listagens. Trocar de funil é sempre escolher onde cair nele.
export const updateDealSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    pipelineId: z.string().min(1).optional(),
    stageId: z.string().min(1).optional(),
    ...optionalFields,
  })
  .refine((data) => !data.pipelineId || !!data.stageId, {
    message: "Informe o estágio de destino ao trocar o negócio de funil",
    path: ["stageId"],
  });

// Transferência em lote. `dealIds` é desduplicado aqui porque o service compara o total encontrado
// com o total pedido para provar que todos são da imobiliária — id repetido faria a contagem bater
// com menos negócios de verdade.
export const bulkTransferDealsSchema = z.object({
  dealIds: z
    .array(z.string().min(1))
    .min(1)
    .max(200)
    .transform((ids) => [...new Set(ids)]),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
});

export const listDealsQuerySchema = z.object({
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type BulkTransferDealsInput = z.infer<typeof bulkTransferDealsSchema>;
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;
