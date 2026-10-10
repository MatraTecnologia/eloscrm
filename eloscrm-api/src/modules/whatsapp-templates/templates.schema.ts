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
  const variables = [...new Set([...input.body.matchAll(/\{\{(\d+)\}\}/g)].map(match => match[1]!))];
  if (variables.some((value, index) => value !== String(index + 1)) || /[{}]/.test(input.body.replace(/\{\{[1-9]\d*\}\}/g, ""))) context.addIssue({ code: "custom", path: ["body"], message: "Use variáveis na ordem {{1}}, {{2}}, sem pular números nem usar zeros à esquerda" });
  if (/^\{\{\d+\}\}|\{\{\d+\}\}$/.test(input.body)) context.addIssue({ code: "custom", path: ["body"], message: "A mensagem não pode começar nem terminar com uma variável; inclua texto fixo antes e depois" });
  if (variables.length !== input.examples.length) context.addIssue({ code: "custom", path: ["examples"], message: "Forneça um exemplo para cada variável da mensagem" });
});
export const templateParamsSchema = z.strictObject({ connectionId: z.string().min(1).max(128), id: z.string().min(1).max(128) });
