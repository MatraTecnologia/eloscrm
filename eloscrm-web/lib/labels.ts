import type {
  ActivityType,
  AuditAction,
  AuditEntity,
  ClientSource,
  ClientStatus,
  NurtureReason,
  PropertyStatus,
  LeadTemperature,
} from "./types";

export const clientSourceLabels: Record<ClientSource, string> = {
  SITE: "Site",
  INSTAGRAM: "Instagram",
  INDICACAO: "Indicação",
  WHATSAPP: "WhatsApp",
  OUTROS: "Outros",
};

export const activityTypeLabels: Record<ActivityType, string> = {
  CALL: "Ligação",
  VISIT: "Visita",
  PROPOSAL: "Proposta",
  NOTE: "Anotação",
};

export const propertyStatusLabels: Record<PropertyStatus, string> = {
  DISPONIVEL: "Disponível",
  RESERVADO: "Reservado",
  VENDIDO: "Vendido",
  INATIVO: "Inativo",
};

export const leadTemperatureLabels: Record<LeadTemperature, string> = {
  FRIO: "Frio",
  MORNO: "Morno",
  QUENTE: "Quente",
};

export const clientStatusLabels: Record<ClientStatus, string> = {
  ACTIVE: "Ativo",
  NURTURING: "Em nutrição",
};

export const nurtureReasonLabels: Record<NurtureReason, string> = {
  SEM_ORCAMENTO: "Orçamento não fecha",
  ADIADO: "Vai comprar mais para frente",
  SEM_RESPOSTA: "Sem resposta",
  COMPROU_COM_OUTRO: "Comprou com outro",
  SO_PESQUISANDO: "Só pesquisando",
  OUTRO: "Outro motivo",
};

// Telefone é persistido em E.164 (+5543998414904) e só formatado na exibição/digitação.
// O DDI só é removido quando o total bate 55 + DDD + número — senão um DDD 55 (Santa Maria/RS)
// seria confundido com o código do país.
export const phoneNationalDigits = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  const national = (digits.length === 12 || digits.length === 13) && digits.startsWith("55")
    ? digits.slice(2)
    : digits;
  return national.slice(0, 11);
};

export const formatPhone = (value: string | null | undefined) => {
  const digits = phoneNationalDigits(value);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  // celular tem 9 dígitos e sempre começa com 9; fixo tem 8. Decidir isso já no primeiro dígito
  // evita o hífen dançar durante a digitação — (43) 99841 em vez de (43) 9-9841.
  const cut = rest.startsWith("9") ? 5 : 4;
  if (rest.length <= cut) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`;
};

export const toE164 = (value: string | null | undefined) => {
  const digits = phoneNationalDigits(value);
  return digits ? `+55${digits}` : undefined;
};

// Campo de moeda trabalha em centavos: o usuário só digita dígitos e a vírgula anda sozinha,
// então não há como digitar "1e5", sinal negativo ou uma vírgula fora de lugar.
const brl = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

export const formatCurrencyInput = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 13);
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", brl);
};

export const parseCurrencyInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) / 100 : undefined;
};

// valor que vem da API (Decimal serializado como string, ex. "420000") para o formato do campo
export const currencyToInput = (value: string | number | null | undefined) =>
  value == null || value === "" ? "" : Number(value).toLocaleString("pt-BR", brl);

export const formatCurrency = (value: string | number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATED: "criou",
  UPDATED: "alterou",
  DELETED: "removeu",
  STAGE_CHANGED: "moveu de estágio",
  OWNER_CHANGED: "trocou o responsável",
};

// Os painéis (arquivos, comentários, histórico, linha do tempo) servem lead e negócio; o texto vazio
// precisa dizer de qual. Todos masculinos de propósito: o texto que os usa escreve "deste <substantivo>".
export const ENTITY_NOUNS: Record<AuditEntity, string> = {
  CLIENT: "lead",
  DEAL: "negócio",
  PROPERTY: "imóvel",
  ACTIVITY: "registro",
};

// nome do campo do banco não pode vazar para a tela
export const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  email: "E-mail",
  phone: "Telefone",
  source: "Origem",
  notes: "Observações",
  ownerId: "Responsável",
  clientId: "Cliente",
  propertyId: "Imóvel",
  stage: "Estágio",
  status: "Status",
  title: "Título",
  value: "Valor",
  dueAt: "Vencimento",
  doneAt: "Conclusão",
  lostReason: "Motivo da perda",
  description: "Descrição",
  tags: "Tags",
  temperature: "Temperatura",
  interestType: "Tipo de interesse",
  budgetMin: "Orçamento mínimo",
  budgetMax: "Orçamento máximo",
  nurtureReason: "Motivo da nutrição",
  nurtureNote: "Detalhe da nutrição",
  nurtureUntil: "Retomar em",
};

// Campos que guardam id: sem tradução o histórico mostra cuid na tela. Quem chama passa o
// `resolveName` (membros, imóveis e clientes da org); id que não resolve é registro já removido.
const ID_FIELDS = new Set(["ownerId", "propertyId", "clientId"]);

// null/undefined viram travessão; o resto é texto puro — o valor vem de uma coluna Json sem forma fixa.
// Usada tanto pelo histórico de auditoria quanto pela timeline unificada do Resumo, para as duas
// telas traduzirem o mesmo jeito.
export const formatAuditValue = (
  field: string,
  value: unknown,
  resolveName?: (id: string) => string | undefined,
) => {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (field === "source") return clientSourceLabels[value as ClientSource] ?? String(value);
  if (field === "temperature") return leadTemperatureLabels[value as LeadTemperature] ?? String(value);
  if (field === "budgetMin" || field === "budgetMax") return formatCurrency(value as string);
  if (field === "status") return clientStatusLabels[value as ClientStatus] ?? String(value);
  if (field === "nurtureReason") return nurtureReasonLabels[value as NurtureReason] ?? String(value);
  if (field === "value") return formatCurrency(value as string);
  if (ID_FIELDS.has(field) && typeof value === "string") return resolveName?.(value) ?? "(removido)";
  return String(value);
};

// tamanho de arquivo em pt-BR: 1,4 MB e não 1.4 MB
export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  return `${(kb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};
