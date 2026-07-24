export type ClientSource = "SITE" | "INSTAGRAM" | "INDICACAO" | "WHATSAPP" | "OUTROS";
export type DealStage =
  | "NOVO_LEAD"
  | "CONTATO"
  | "QUALIFICADO"
  | "VISITA"
  | "PROPOSTA"
  | "FECHADO"
  | "PERDIDO";
export type ActivityType = "CALL" | "VISIT" | "PROPOSAL" | "NOTE";
export type PropertyStatus = "DISPONIVEL" | "RESERVADO" | "VENDIDO" | "INATIVO";

export type Client = {
  id: string;
  organizationId: string;
  ownerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: ClientSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Deal = {
  id: string;
  organizationId: string;
  clientId: string;
  propertyId: string | null;
  ownerId: string | null;
  title: string;
  value: string | null;
  stage: DealStage;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  organizationId: string;
  clientId: string | null;
  dealId: string | null;
  type: ActivityType;
  description: string;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Property = {
  id: string;
  organizationId: string;
  title: string;
  type: string | null;
  address: string | null;
  price: string | null;
  bedrooms: number | null;
  area: number | null;
  status: PropertyStatus;
  photos: string[];
  createdAt: string;
  updatedAt: string;
};

export type DashboardStats = {
  kpis: { totalClients: number; totalDeals: number; openDeals: number; wonDeals: number; openValue: number };
  funnel: Record<DealStage, number>;
  bySource: Record<ClientSource, number>;
};
