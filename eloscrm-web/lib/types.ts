export type ClientSource = "SITE" | "INSTAGRAM" | "INDICACAO" | "WHATSAPP" | "OUTROS";
export type ActivityType = "CALL" | "VISIT" | "PROPOSAL" | "NOTE";
export type PropertyStatus = "DISPONIVEL" | "RESERVADO" | "VENDIDO" | "INATIVO";
export type LeadTemperature = "FRIO" | "MORNO" | "QUENTE";

export type Client = {
  id: string;
  organizationId: string;
  ownerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: ClientSource;
  notes: string | null;
  description: string | null;
  tags: string[];
  temperature: LeadTemperature;
  interestType: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
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

export type AuditEntity = "CLIENT" | "DEAL" | "PROPERTY" | "ACTIVITY";
export type AuditAction = "CREATED" | "UPDATED" | "DELETED" | "STAGE_CHANGED" | "OWNER_CHANGED";

export type AuditEvent = {
  id: string;
  entityType: AuditEntity;
  entityId: string;
  action: AuditAction;
  actorId: string | null;
  actorName: string | null;
  // { campo: { from, to } } — só os campos que mudaram
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
};

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

export type Comment = {
  id: string;
  organizationId: string;
  entityType: AuditEntity;
  entityId: string;
  authorId: string;
  authorName: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttachmentStatus = "PENDING" | "READY";

export type Attachment = {
  id: string;
  organizationId: string;
  entityType: AuditEntity;
  entityId: string;
  filename: string;
  contentType: string;
  size: number;
  status: AttachmentStatus;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
};

export type TimelineItem =
  | {
      kind: "ACTIVITY";
      id: string;
      at: string;
      payload: { type: ActivityType; description: string; dueAt: string | null; doneAt: string | null };
    }
  | {
      kind: "AUDIT";
      id: string;
      at: string;
      payload: {
        action: AuditAction;
        actorName: string | null;
        changes: Record<string, { from: unknown; to: unknown }> | null;
      };
    }
  | {
      kind: "COMMENT";
      id: string;
      at: string;
      payload: { body: string; authorId: string; authorName: string; editedAt: string | null };
    }
  | {
      kind: "ATTACHMENT";
      id: string;
      at: string;
      payload: { filename: string; contentType: string; size: number; uploadedByName: string };
    };
