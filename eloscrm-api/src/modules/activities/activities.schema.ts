import * as z from "zod";
import { ActivityType } from "../../generated/prisma/client.js";

export const createActivitySchema = z.object({
  type: z.enum(ActivityType),
  description: z.string().min(1),
  clientId: z.string().optional(),
  dealId: z.string().optional(),
  dueAt: z.coerce.date().optional(),
  doneAt: z.coerce.date().optional(),
});

export const updateActivitySchema = createActivitySchema.partial();

export const listActivitiesQuerySchema = z.object({
  clientId: z.string().optional(),
  dealId: z.string().optional(),
  type: z.enum(ActivityType).optional(),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
