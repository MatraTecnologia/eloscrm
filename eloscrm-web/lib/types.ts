export type ClientSource = "SITE" | "INSTAGRAM" | "INDICACAO" | "WHATSAPP" | "OUTROS";
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

export type Stage = {
  id: string;
  organizationId: string;
  pipelineId: string;
  name: string;
  position: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Pipeline = {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  position: number;
  stages: Stage[];
  createdAt: string;
  updatedAt: string;
};

export type Deal = {
  id: string;
  organizationId: string;
  clientId: string;
  propertyId: string | null;
  pipelineId: string;
  stageId: string;
  ownerId: string | null;
  title: string;
  value: string | null;
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
  // só /v1/agenda faz o include; em /v1/activities os campos não vêm
  client?: { id: string; name: string } | null;
  deal?: { id: string; title: string } | null;
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
  funnel: { name: string; total: number }[];
  bySource: Record<ClientSource, number>;
};
