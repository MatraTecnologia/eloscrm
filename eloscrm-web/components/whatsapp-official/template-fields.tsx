import type { OfficialTemplate } from "@/lib/messaging-types";
import { Input } from "@/components/ui/input";
import type { ParameterSource } from "@/lib/campaign-types";

export const parameterSourceLabels: Record<ParameterSource, string> = { firstName: "Primeiro nome", fullName: "Nome completo", dealTitle: "Título do negócio", dealValue: "Valor do negócio", propertyTitle: "Nome do imóvel", ownerName: "Nome do corretor" };

export const templateSupported = (template: OfficialTemplate) => template.status === "APPROVED" && template.category !== "AUTHENTICATION" && !template.definition.components.some(component =>
  !["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(component.type) || (component.type === "HEADER" && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(component.format ?? "")) ||
  (component.type === "BUTTONS" && component.buttons?.some(button => !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(button.type) || (button.url?.includes("{{") && !/^https:\/\/[^{}]+\{\{1\}\}$/.test(button.url))))
);
export const templateHeaderFormat = (template?: OfficialTemplate) => template?.definition.components.find(component => component.type === "HEADER" && component.format !== "TEXT")?.format;
export const templateButtons = (template?: OfficialTemplate) => (template?.definition.components.find(component => component.type === "BUTTONS")?.buttons ?? []).flatMap((button, index) => button.type === "URL" && button.url?.includes("{{") ? [{ index: String(index), key: `buttons:${index}`, url: button.url.replace("{{1}}", "") }] : []);
export const templateVariables = (template?: OfficialTemplate) => (["header", "body"] as const).flatMap(part => {
  const text = template?.definition.components.find(component => component.type === part.toUpperCase())?.text ?? "";
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(match => match[1]!))].map(name => ({ part, name, key: `${part}:${name}` }));
});
export const TemplateFields = ({ template, values, onChange, disabled, sources, onSourceChange }: { template: OfficialTemplate; values: Record<string, string>; onChange: (key: string, value: string) => void; disabled: boolean; sources?: Record<string, ParameterSource | "">; onSourceChange?: (key: string, value: ParameterSource | "") => void }) => {
  const variables = templateVariables(template);
  const body = template.definition.components.find(component => component.type === "BODY")?.text ?? "";
  const preview = body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => sources?.[`body:${name}`] ? `[${parameterSourceLabels[sources[`body:${name}`] as ParameterSource]}]` : values[`body:${name}`] || match);
  return <div className="space-y-2">
    {variables.map(variable => <div key={variable.key} className="space-y-1 text-xs"><span>{variable.part === "header" ? "Cabeçalho" : "Mensagem"}: {variable.name}</span>
      {onSourceChange && <select aria-label={`Origem ${variable.key}`} className="w-full rounded-md border bg-background p-2 text-sm" value={sources?.[variable.key] ?? ""} disabled={disabled} onChange={event => onSourceChange(variable.key, event.target.value as ParameterSource | "")}><option value="">Texto fixo</option>{Object.entries(parameterSourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
      {!sources?.[variable.key] && <Input aria-label={`Valor ${variable.key}`} value={values[variable.key] ?? ""} maxLength={variable.part === "header" ? 60 : 1024} disabled={disabled} onChange={event => onChange(variable.key, event.target.value)} />}
    </div>)}
    {templateButtons(template).map(button => <label key={button.key} className="block space-y-1 text-xs">Botão {Number(button.index) + 1}: complemento do endereço
      <span className="block break-all text-muted-foreground">{button.url}</span><Input aria-label={`Complemento do botão ${Number(button.index) + 1}`} value={values[button.key] ?? ""} maxLength={256} pattern="[A-Za-z0-9._~-]+" disabled={disabled} onChange={event => onChange(button.key, event.target.value)} />
    </label>)}
    <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-sm" aria-label="Prévia do template">{preview}</p>
  </div>;
};
