import * as z from "zod";

// hex de seis dígitos, sempre: a tela deriva fundo e borda do chip por concatenação de alfa
// ("#2563eb22"), o que só funciona com o formato fechado
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida")
  .transform((value) => value.toLowerCase());

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color,
});

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: color.optional(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
