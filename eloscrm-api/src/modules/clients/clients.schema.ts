import * as z from "zod";
import { ClientSource } from "../../generated/prisma/client.js";

export const createClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.enum(ClientSource).optional(),
  notes: z.string().optional(),
  ownerId: z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const listClientsQuerySchema = z.object({
  source: z.enum(ClientSource).optional(),
  ownerId: z.string().optional(),
  q: z.string().optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
