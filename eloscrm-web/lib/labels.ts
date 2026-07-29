import type { ActivityType, AuditAction, ClientSource, PropertyStatus } from "./types";

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

// nome do campo do banco não pode vazar para a tela
export const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  email: "E-mail",
  phone: "Telefone",
  source: "Origem",
  notes: "Observações",
  ownerId: "Responsável",
  stage: "Estágio",
  status: "Status",
  title: "Título",
  value: "Valor",
  dueAt: "Vencimento",
  doneAt: "Conclusão",
  lostReason: "Motivo da perda",
  description: "Descrição",
};
