import type { BroadcastPreviewRow } from "@/lib/types";
import { formatCurrency } from "@/lib/labels";

// Espelho de `eloscrm-api/src/modules/broadcasts/template.ts`: a prévia na tela precisa produzir o
// mesmo texto que o worker vai enviar.
export const TEMPLATE_VARIABLES = [
  { key: "nome", label: "Primeiro nome" },
  { key: "nome_completo", label: "Nome completo" },
  { key: "titulo", label: "Título do negócio" },
  { key: "valor", label: "Valor" },
  { key: "imovel", label: "Imóvel" },
  { key: "corretor", label: "Responsável" },
] as const;

type Vars = Record<(typeof TEMPLATE_VARIABLES)[number]["key"], string>;

export const templateVarsOf = (row: BroadcastPreviewRow): Vars => ({
  nome: row.client.name.trim().split(/\s+/)[0] ?? "",
  nome_completo: row.client.name,
  titulo: row.title,
  valor: row.value != null ? formatCurrency(row.value) : "",
  imovel: row.propertyTitle ?? "",
  corretor: row.ownerName ?? "",
});

export const renderTemplate = (text: string, vars: Vars) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const name = key.toLowerCase() as keyof Vars;
    return name in vars ? vars[name] : match;
  });
