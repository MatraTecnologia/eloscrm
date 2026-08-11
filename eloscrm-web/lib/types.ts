export type ClientSource = "SITE" | "INSTAGRAM" | "INDICACAO" | "WHATSAPP" | "OUTROS";
export type ActivityType = "CALL" | "VISIT" | "PROPOSAL" | "NOTE";
export type PropertyStatus = "DISPONIVEL" | "RESERVADO" | "VENDIDO" | "INATIVO";
export type LeadTemperature = "FRIO" | "MORNO" | "QUENTE";
export type ClientStatus = "ACTIVE" | "NURTURING";
export type NurtureReason =
  | "SEM_ORCAMENTO"
  | "ADIADO"
  | "SEM_RESPOSTA"
  | "COMPROU_COM_OUTRO"
  | "SO_PESQUISANDO"
  | "OUTRO";

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
  status: ClientStatus;
  nurtureReason: NurtureReason | null;
  nurtureNote: string | null;
  nurtureUntil: string | null;
  nurturedAt: string | null;
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
  kpis: {
    totalClients: number;
    totalDeals: number;
    openDeals: number;
    wonDeals: number;
    openValue: number;
    nurturing: number;
    nurtureDue: number;
  };
  funnel: { name: string; total: number }[];
  bySource: Record<ClientSource, number>;
};

export type AuditEntity =
  | "CLIENT"
  | "DEAL"
  | "PROPERTY"
  | "ACTIVITY"
  | "PIPELINE"
  | "STAGE"
  | "COMMENT"
  | "ATTACHMENT"
  | "CONVERSATION"
  | "WHATSAPP_MESSAGE"
  | "WHATSAPP_INSTANCE"
  | "LEAD_AUTOMATION"
  | "MEMBER"
  | "INVITATION"
  | "ORGANIZATION"
  | "SESSION";

/** Comentário e anexo só existem para estas quatro — espelha ANNOTATABLE_ENTITIES da API. */
export type AnnotatableEntity = "CLIENT" | "DEAL" | "PROPERTY" | "ACTIVITY";

export type AuditAction =
  | "CREATED"
  | "UPDATED"
  | "DELETED"
  | "STAGE_CHANGED"
  | "OWNER_CHANGED"
  | "TRANSFERRED"
  | "REORDERED"
  | "NURTURED"
  | "REACTIVATED"
  | "ARCHIVED"
  | "UNARCHIVED"
  | "LINKED"
  | "UNLINKED"
  | "UPLOADED"
  | "DOWNLOADED"
  | "MESSAGE_SENT"
  | "MESSAGE_DELETED"
  | "CONNECTED"
  | "DISCONNECTED"
  | "RESET"
  | "SYNCED"
  | "WEBHOOK_RECONCILED"
  | "TEST_MESSAGE_SENT"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "MEMBER_ADDED"
  | "MEMBER_REMOVED"
  | "ROLE_CHANGED"
  | "INVITED"
  | "INVITE_REVOKED"
  | "EXPORTED"
  | "PURGED";

export type AuditSource = "USER" | "AUTOMATION" | "WEBHOOK" | "SYSTEM";

export type AuditEvent = {
  id: string;
  entityType: AuditEntity;
  entityId: string;
  // nome que o item tinha no momento do fato; nulo em evento antigo, anterior ao backfill
  entityLabel: string | null;
  action: AuditAction;
  source: AuditSource;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  organizationName: string | null;
  // { campo: { from, to } } — só os campos que mudaram
  changes: Record<string, { from: unknown; to: unknown }> | null;
  // a que o item pertencia (lead, funil, estágio…), desnormalizado no próprio evento
  context: Record<string, unknown> | null;
  // estado no momento do fato, por allowlist — telefone e e-mail vêm mascarados
  snapshot: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
};

/**
 * GET /v1/organization/deletion-preview — o que a exclusão da imobiliária vai levar.
 *
 * `storage` e `whatsapp` são o que o cascade do banco **não** alcança: objetos no R2 e a conexão no
 * provedor. Estão separados por isso, e porque são a parte que o dono não tem como recuperar.
 */
/**
 * GET /v1/whatsapp/instance/deletion-preview.
 *
 * `conversations` e `messages` existem porque `Conversation` cascateia da instância: remover a conexão
 * apaga o atendimento inteiro, não só o vínculo com o provedor.
 */
/**
 * GET /v1/pipelines/:id/deletion-preview.
 *
 * `blockers` é o que impede a exclusão — negócio dentro do funil se transfere ou se fecha; "é o único
 * funil" se resolve criando outro. São caminhos diferentes, então a tela mostra cada um.
 */
export type PipelineDeletionPreview = {
  pipeline: { id: string; name: string };
  stages: string[];
  deals: { total: number; open: number; closed: number };
  dealsByStage: { stage: string; count: number }[];
  canDelete: boolean;
  blockers: { code: string; message: string }[];
  totalPipelines: number;
};

export type WhatsappDeletionPreview = {
  instance: { name: string; status: string; connected: boolean };
  conversations: number;
  messages: number;
  storage: { objects: number; bytes: number };
};

export type OrgDeletionPreview = {
  organization: { id: string; name: string; slug: string };
  counts: {
    clients: number;
    deals: number;
    activities: number;
    properties: number;
    pipelines: number;
    stages: number;
    comments: number;
    attachments: number;
    conversations: number;
    whatsappMessages: number;
    members: number;
    invitations: number;
    auditEvents: number;
    leadAutomation: number;
  };
  storage: { objects: number; bytes: number };
  whatsapp: { name: string; status: string; connected: boolean } | null;
};

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

// Envelope paginado por cursor de GET /v1/audit-events — mesmo formato de outras listas do app.
export type AuditSearchResult = { items: AuditEvent[]; nextCursor?: string };

/**
 * GET /v1/audit-events/actors. `actorId` é `null` para os atores sintéticos (Automação, WhatsApp,
 * Sistema) — `recordAudit` grava `null` quando `actor.id` é vazio, então esses eventos só se
 * distinguem entre si por `actorName`/`source`, nunca por `actorId`.
 */
export type AuditActor = { actorId: string | null; actorName: string; events: number };

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

// /v1/agenda passou a ter duas fontes e devolve uma união discriminada, no mesmo formato do
// TimelineItem. `at` é o dueAt da atividade ou o nurtureUntil do lead a retomar.
export type NurturePayload = {
  clientId: string;
  clientName: string;
  phone: string | null;
  reason: NurtureReason | null;
  note: string | null;
};

export type AgendaItem =
  | { kind: "ACTIVITY"; id: string; at: string; payload: Activity }
  | { kind: "NURTURE"; id: string; at: string; payload: NurturePayload };

// Espelha os models UazapiInstance/UazapiInstanceLog do Prisma (a duplicação é à mão, como o resto
// deste arquivo). `hibernated` é sessão pausada com credenciais preservadas — uazapi v2.1.1.
export type WhatsappStatus = "disconnected" | "connecting" | "connected" | "hibernated";

export type WhatsappInstance = {
  id: string;
  organizationId: string;
  remoteId: string;
  name: string;
  tokenLast4: string | null;
  status: WhatsappStatus;
  lastStatusAt: string | null;
  qrcode: string | null;
  paircode: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  isBusiness: boolean | null;
  plataform: string | null;
  ownerJid: string | null;
  systemName: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  remoteDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // só na resposta de criação: false quando a instância nasceu mas o webhook não pôde ser registrado
  webhookConfigured?: boolean;
};

export type WhatsappLogEvent =
  | "created"
  | "connect_requested"
  | "qr_generated"
  | "paircode_generated"
  | "connected"
  | "disconnected"
  | "status_changed"
  | "reset"
  | "synced"
  | "name_updated"
  | "webhook_configured"
  | "test_message_sent"
  | "remote_deleted"
  | "deleted"
  | "error";

export type WhatsappLog = {
  id: string;
  event: WhatsappLogEvent;
  source: "manual" | "webhook" | "sync" | "system";
  previousStatus: WhatsappStatus | null;
  newStatus: WhatsappStatus | null;
  message: string | null;
  createdAt: string;
};

export type WhatsappWebhookConfig = {
  id: string;
  enabled: boolean;
  events: string[];
  excludeMessages?: string[];
  url: string;
  isOurs: boolean;
};

export type WhatsappWebhookErrors = {
  errors: {
    url: string;
    event: string;
    type: string;
    error: string;
    attempts: number;
    status_code?: number;
    created: string;
    message_type?: string;
  }[];
  captureStartedAt?: string;
};

// Passthrough de GET /instance/wa-limits. Os campos vêm da uazapi; nem todos aparecem sempre.
export type WhatsappLimits = {
  can_send_new_messages: boolean | null;
  reachable: boolean;
  message: string;
  message_ptbr: string;
  provider: string;
  provider_message_ptbr?: string;
  diagnostics_endpoint?: string;
  new_chat_message_capping?: {
    available: boolean;
    status?: string;
    total_quota?: number;
    used_quota?: number;
    cycle_start?: string;
    cycle_end?: string;
    lookup_error?: string;
  };
  reachout_timelock?: {
    active: boolean;
    available: boolean;
    until?: string;
    enforcement_type?: string;
    lookup_error?: string;
  };
};

// Conversas de WhatsApp. Espelha os models Conversation/WhatsappMessage do Prisma.
export type WhatsappMessageType =
  | "text" | "image" | "video" | "gif" | "audio" | "ptt"
  | "document" | "sticker" | "location" | "contact"
  | "reaction" | "poll" | "system" | "unsupported";

export type WhatsappMessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type WhatsappMediaStatus = "none" | "pending" | "ready" | "failed";

export type ConversationClient = {
  id: string;
  name: string;
  phone: string | null;
  status: ClientStatus;
  temperature: LeadTemperature;
};

export type Conversation = {
  id: string;
  chatid: string;
  phone: string | null;
  isGroup: boolean;
  waName: string | null;
  contactName: string | null;
  photoUrl: string | null;
  clientId: string | null;
  client: ConversationClient | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  lastMessage: ConversationPreview | null;
  unreadCount: number;
  archivedAt: string | null;
  createdAt: string;
};

// Última mensagem da conversa, resumida para a linha da lista. De mensagem apagada a API não manda
// texto nem nome de arquivo — só o `deletedAt`, que é o que a prévia precisa saber.
export type ConversationPreview = {
  id: string;
  direction: "inbound" | "outbound";
  type: WhatsappMessageType;
  text: string | null;
  mediaFilename: string | null;
  mediaDuration: number | null;
  contacts: SharedContact[] | null;
  location: SharedLocation | null;
  poll: SharedPoll | null;
  deletedAt: string | null;
};

// Prévia da mensagem citada num reply — vem resolvida pela API, sem URL de mídia assinada.
export type WhatsappQuoted = {
  id: string;
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  type: WhatsappMessageType;
  text: string | null;
  senderName: string | null;
  mediaThumb: string | null;
  // apagada no WhatsApp: a API não manda o conteúdo, só o marcador
  deletedAt: string | null;
};

/** Enquete criada na conversa. Os votos vêm em evento próprio e a ingestão não os consome. */
export type SharedPoll = {
  name: string;
  options: string[];
  /** true quando dá para marcar mais de uma */
  multiple: boolean;
};

/** Localização compartilhada. `name`/`address` só vêm quando é um lugar, não um ponto no mapa. */
export type SharedLocation = {
  lat: number;
  lng: number;
  name: string | null;
  address: string | null;
  url: string | null;
};

/** Um contato que o cliente compartilhou na conversa. */
export type SharedContact = {
  name: string;
  /** telefones em dígitos, como vieram no vCard */
  phones: string[];
  /** nome comercial, quando o contato é uma conta business */
  business: string | null;
};

// Reação a uma mensagem. `authorLid` é chave interna e não sai da API — o que a bolha precisa é o
// emoji e se foi a imobiliária que reagiu.
export type WhatsappReaction = {
  emoji: string;
  mine: boolean;
  authorName: string | null;
};

export type WhatsappMessage = {
  id: string;
  providerId: string;
  // id puro no provedor; nulo enquanto o envio não foi confirmado — e é o que torna a mensagem citável
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  type: WhatsappMessageType;
  rawType: string | null;
  status: WhatsappMessageStatus;
  text: string | null;
  // id da citada no provedor; com `quoted` nulo, a original está fora do que foi carregado
  quotedId: string | null;
  quoted: WhatsappQuoted | null;
  // "apagar para todos": a linha continua na thread, o conteúdo não vem da API
  deletedAt: string | null;
  reactions: WhatsappReaction[];
  // fixar é nativo do WhatsApp e expira; `pinnedUntil` é o que tira da barra do topo sozinho
  pinnedAt: string | null;
  pinnedUntil: string | null;
  // favoritar é marca do CRM, compartilhada pela imobiliária — não vai para o WhatsApp de ninguém
  favoritedAt: string | null;
  favoritedById: string | null;
  senderName: string | null;
  sentByApi: boolean;
  sentAt: string;
  mediaStatus: WhatsappMediaStatus;
  mediaMime: string | null;
  mediaSize: number | null;
  mediaFilename: string | null;
  mediaDuration: number | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  // JPEGThumbnail em base64: preview que chega junto do webhook, sem requisição
  mediaThumb: string | null;
  mediaWaveform: string | null;
  mediaError: string | null;
  // contato compartilhado, já traduzido do vCard pela ingestão
  contacts: SharedContact[] | null;
  location: SharedLocation | null;
  poll: SharedPoll | null;
  // já resolvida pela API (R2 presigned ou URL temporária do provedor); null se indisponível
  mediaUrl: string | null;
  mediaSource: "r2" | "provider" | null;
};

// Automação de entrada de leads. Espelha LeadAutomation/LeadAutomationMember do Prisma.
export type LeadAutomationMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
  /** participa da roleta */
  active: boolean;
  /** negócios abertos hoje — é o critério da distribuição, e o que explica a próxima escolha */
  openDeals: number;
};

export type LeadAutomation = {
  autoCreateClient: boolean;
  autoCreateDeal: boolean;
  pipelineId: string | null;
  stageId: string | null;
  autoAssign: boolean;
  strategy: "LEAST_OPEN";
  members: LeadAutomationMember[];
};
