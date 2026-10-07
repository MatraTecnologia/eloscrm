import * as z from "zod";

export const createTemplateSchema = z.strictObject({
  name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/),
  language: z.enum(["pt_BR", "en_US", "es"]),
  category: z.enum(["MARKETING", "UTILITY"]),
  header: z.string().trim().max(60).default("").refine(value => !value.includes("{{"), "O cabeçalho deve ter texto fixo"),
  body: z.string().trim().min(1).max(1024),
  footer: z.string().trim().max(60).default("").refine(value => !value.includes("{{"), "O rodapé deve ter texto fixo"),
  examples: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
}).superRefine((input, context) => {
  const variables = [...new Set([...input.body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1])))].sort((a, b) => a - b);
  if (variables.some((value, index) => value !== index + 1) || variables.length !== input.examples.length || /[{}]/.test(input.body.replace(/\{\{\d+\}\}/g, ""))) context.addIssue({ code: "custom", path: ["examples"], message: "Use variáveis sequenciais, como {{1}}, e forneça um exemplo para cada uma" });
});
export const templateParamsSchema = z.strictObject({ connectionId: z.string().min(1).max(128), id: z.string().min(1).max(128) });
