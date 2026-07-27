import * as z from "zod";

export const createDealSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  propertyId: z.string().optional(),
  ownerId: z.string().optional(),
  value: z.number().optional(),
  lostReason: z.string().optional(),
});

export const updateDealSchema = createDealSchema.partial();

export const listDealsQuerySchema = z.object({
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;
