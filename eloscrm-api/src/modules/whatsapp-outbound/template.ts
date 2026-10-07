import { httpError } from "../../lib/http-error.js";
import type { SendInput, TemplateDefinition } from "./outbound.schema.js";

export const buildTemplate = (definition: TemplateDefinition, input: Extract<SendInput, { type: "template" }>) => {
  if (definition.status !== "APPROVED") throw httpError(422, "OFFICIAL_TEMPLATE_UNAVAILABLE", "O template não está aprovado na Meta");
  // Autenticação e componentes especiais exigem contratos próprios; não são tratados como texto.
  if (definition.category === "AUTHENTICATION" || definition.components.some(component =>
    !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(component.type) ||
    (component.type === "HEADER" && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(component.format ?? "")) ||
    (component.type === "BUTTONS" && component.buttons?.some(button => !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(button.type) || (button.url?.includes("{{") && !/^https:\/\/[^{}]+\{\{1\}\}$/.test(button.url))))
  )) throw httpError(422, "OFFICIAL_TEMPLATE_UNSUPPORTED", "Este template exige componentes ainda não suportados pelo CRM");
  const components: Record<string, unknown>[] = [];
  let preview = "";
  const mediaHeader = definition.components.find(component => component.type === "HEADER" && component.format !== "TEXT");
  if (!!mediaHeader !== !!input.headerUploadId) throw httpError(422, "OFFICIAL_TEMPLATE_MEDIA", "O cabeçalho exige um arquivo compatível com este template");
  if (mediaHeader) {
    const type = mediaHeader.format!.toLowerCase();
    components.push({ type: "header", parameters: [{ type, [type]: { id: input.headerUploadId } }] });
  }
  const dynamicButtons = (definition.components.find(component => component.type === "BUTTONS")?.buttons ?? []).flatMap((button, index) => button.type === "URL" && button.url?.includes("{{") ? [String(index)] : []);
  const buttons = input.parameters.buttons ?? {};
  if (dynamicButtons.length !== Object.keys(buttons).length || dynamicButtons.some(index => !Object.hasOwn(buttons, index))) throw httpError(422, "OFFICIAL_TEMPLATE_PARAMETERS", "Preencha os parâmetros dos botões deste template");
  for (const index of dynamicButtons) components.push({ type: "button", sub_type: "url", index, parameters: [{ type: "text", text: buttons[index] }] });
  for (const part of ["header", "body"] as const) {
    const text = definition.components.find(component => component.type === part.toUpperCase())?.text ?? "";
    const names = [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(match => match[1]!))];
    const values = input.parameters[part];
    if (names.length !== Object.keys(values).length || names.some(name => !Object.hasOwn(values, name))) throw httpError(422, "OFFICIAL_TEMPLATE_PARAMETERS", "As variáveis não correspondem ao template selecionado");
    if (definition.parameter_format !== "NAMED") {
      names.sort((left, right) => Number(left) - Number(right));
      if (names.some((name, index) => name !== String(index + 1))) throw httpError(422, "OFFICIAL_TEMPLATE_UNSUPPORTED", "O template possui variáveis posicionais inválidas");
    }
    const rendered = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => values[name]!);
    // Limites conservadores do CRM para o texto final, incluindo as variáveis substituídas.
    if (rendered.length > (part === "header" ? 60 : 1024)) throw httpError(422, "OFFICIAL_TEMPLATE_LENGTH", "O texto preenchido excedeu o limite do template");
    if (names.length) components.push({ type: part, parameters: names.map(name => ({ type: "text", text: values[name], ...(definition.parameter_format === "NAMED" ? { parameter_name: name } : {}) })) });
    if (part === "body") preview = rendered;
  }
  return { payload: { name: definition.name, language: { code: definition.language }, ...(components.length ? { components } : {}) }, preview };
};
