import * as z from "zod";

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
