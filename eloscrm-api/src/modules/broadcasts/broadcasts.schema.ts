import * as z from "zod";

const ids = z.array(z.string().min(1)).max(50);

/**
 * Condições que selecionam negócios de um funil. Todas opcionais e combinadas por E: omitida, a
 * condição não restringe. É o mesmo formato que uma automação futura vai gravar — por isso mora
 * aqui e não no corpo do disparo.
 */
export const broadcastFiltersSchema = z
  .object({
    stageIds: ids.optional(),
    // "tem alguma destas" / "não tem nenhuma destas"
    tagsAny: ids.optional(),
    tagsNone: ids.optional(),
    value: z.enum(["FILLED", "EMPTY"]).optional(),
    valueMin: z.number().nonnegative().optional(),
    valueMax: z.number().nonnegative().optional(),
    temperatures: z.array(z.enum(["FRIO", "MORNO", "QUENTE"])).optional(),
    ownerIds: ids.optional(),
    // retorno do lead no WhatsApp: NO_REPLY = a última mensagem da conversa é nossa (contatamos e
    // ninguém respondeu); REPLIED = a última é dele. Quem nunca conversou fica de fora nos dois.
    reply: z.enum(["NO_REPLY", "REPLIED"]).optional(),
    // só com NO_REPLY: a nossa última mensagem tem pelo menos N dias — evita cobrar retorno de quem
    // recebeu a primeira mensagem há uma hora
    noReplyDays: z.number().int().min(1).max(365).optional(),
  })
  .refine((f) => f.valueMin === undefined || f.valueMax === undefined || f.valueMin <= f.valueMax, {
    message: "Valor mínimo maior que o máximo",
    path: ["valueMax"],
  });

export const previewBroadcastSchema = z.object({
  pipelineId: z.string().min(1),
  filters: broadcastFiltersSchema.default({}),
});

// `dealIds` é o subconjunto marcado na tela entre os que o filtro devolveu: o filtro seleciona, a
// pessoa ainda desmarca quem não deve receber. Desduplicado porque cada destinatário é único por
// negócio no banco.
export const createBroadcastSchema = z.object({
  pipelineId: z.string().min(1),
  filters: broadcastFiltersSchema.default({}),
  dealIds: z
    .array(z.string().min(1))
    .min(1)
    .max(200)
    .transform((list) => [...new Set(list)]),
  text: z.string().trim().min(1).max(2000),
});

export const listBroadcastsQuerySchema = z.object({
  pipelineId: z.string().optional(),
});

export type BroadcastFilters = z.infer<typeof broadcastFiltersSchema>;
export type PreviewBroadcastInput = z.infer<typeof previewBroadcastSchema>;
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;
export type ListBroadcastsQuery = z.infer<typeof listBroadcastsQuerySchema>;
