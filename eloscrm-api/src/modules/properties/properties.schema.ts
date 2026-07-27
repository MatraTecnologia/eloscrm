import * as z from "zod";
import { PropertyStatus } from "../../generated/prisma/client.js";

export const createPropertySchema = z.object({
  title: z.string().min(1),
  type: z.string().optional(),
  address: z.string().optional(),
  price: z.number().optional(),
  bedrooms: z.number().int().optional(),
  area: z.number().optional(),
  status: z.enum(PropertyStatus).optional(),
  photos: z.array(z.string()).optional(),
});

export const updatePropertySchema = createPropertySchema.partial();

export const listPropertiesQuerySchema = z.object({
  status: z.enum(PropertyStatus).optional(),
  q: z.string().optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;
