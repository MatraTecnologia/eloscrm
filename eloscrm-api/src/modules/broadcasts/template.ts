/**
 * Variáveis do texto do disparo: `{{nome}}`, `{{nome_completo}}`, `{{titulo}}`, `{{valor}}`,
 * `{{imovel}}`, `{{corretor}}`. Espelhado em `eloscrm-web/lib/broadcast-template.ts`, que faz a
 * prévia na tela — mudar uma lista sem a outra deixa a prévia mentindo.
 */
export type TemplateVars = {
  nome: string;
  nome_completo: string;
  titulo: string;
  valor: string;
  imovel: string;
  corretor: string;
};

export const TEMPLATE_VARIABLES = [
  "nome",
  "nome_completo",
  "titulo",
  "valor",
  "imovel",
  "corretor",
] as const satisfies readonly (keyof TemplateVars)[];

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const templateVarsOf = (deal: {
  title: string;
  value: { toString(): string } | null;
  client: { name: string };
  property: { title: string } | null;
  ownerName: string | null;
}): TemplateVars => ({
  nome: deal.client.name.trim().split(/\s+/)[0] ?? "",
  nome_completo: deal.client.name,
  titulo: deal.title,
  valor: deal.value != null ? currency.format(Number(deal.value.toString())) : "",
  imovel: deal.property?.title ?? "",
  corretor: deal.ownerName ?? "",
});

// variável desconhecida fica como está, visível: apagá-la esconderia o erro de digitação e o
// cliente receberia uma frase com buraco
export const renderTemplate = (text: string, vars: TemplateVars) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const name = key.toLowerCase() as keyof TemplateVars;
    return name in vars ? vars[name] : match;
  });
