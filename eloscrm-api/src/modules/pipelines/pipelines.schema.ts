import * as z from "zod";

const templateStageSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export const createPipelineSchema = z.object({
  name: z.string().min(1),
  stages: z.array(templateStageSchema).min(1).optional(),
});

export const updatePipelineSchema = z.object({
  name: z.string().min(1).optional(),
});

export const createStageSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export const updateStageSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  position: z.number().int().optional(),
});

export const reorderStagesSchema = z.object({
  stageIds: z.array(z.string().min(1)),
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;
