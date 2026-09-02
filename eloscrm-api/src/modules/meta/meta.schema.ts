import * as z from "zod";
import { MetaTokenType } from "../../generated/prisma/client.js";

export const connectMetaSchema = z.object({
  token: z.string().trim().min(20, "Token curto demais para ser um token do Meta"),
  tokenType: z.enum(MetaTokenType),
});

export const updateMetaSettingsSchema = z.object({
  // nulo é estado real: integração conectada e destino ainda não escolhido
  pipelineId: z.string().min(1).nullable(),
  stageId: z.string().min(1).nullable(),
});

export const updateMetaFormSchema = z.object({
  enabled: z.boolean(),
  // null = usa o destino padrão da integração
  pipelineId: z.string().min(1).nullable(),
  stageId: z.string().min(1).nullable(),
});

export const listMetaLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ConnectMetaInput = z.infer<typeof connectMetaSchema>;
export type UpdateMetaSettingsInput = z.infer<typeof updateMetaSettingsSchema>;
export type UpdateMetaFormInput = z.infer<typeof updateMetaFormSchema>;
export type ListMetaLeadsQuery = z.infer<typeof listMetaLeadsQuerySchema>;
