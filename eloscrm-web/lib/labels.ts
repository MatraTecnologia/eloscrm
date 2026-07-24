import type { ActivityType, ClientSource, DealStage, PropertyStatus } from "./types";

export const dealStageLabels: Record<DealStage, string> = {
  NOVO_LEAD: "Novo lead",
  CONTATO: "Contato",
  QUALIFICADO: "Qualificado",
  VISITA: "Visita",
  PROPOSTA: "Proposta",
  FECHADO: "Fechado",
  PERDIDO: "Perdido",
};

export const dealStageOrder: DealStage[] = [
  "NOVO_LEAD",
  "CONTATO",
  "QUALIFICADO",
  "VISITA",
  "PROPOSTA",
  "FECHADO",
  "PERDIDO",
];

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

export const formatCurrency = (value: string | number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
