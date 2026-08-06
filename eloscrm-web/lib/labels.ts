import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ActivityType,
  AuditAction,
  AuditEntity,
  AuditSource,
  ClientSource,
  ClientStatus,
  NurtureReason,
  PropertyStatus,
  LeadTemperature,
  WhatsappMessageType,
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

// Resumo de uma mensagem quando não há texto para mostrar — citação de mídia, prévia da conversa.
// "Mensagem" nos casos que sempre trazem texto: o rótulo só aparece quando o texto falta.
export const whatsappMessageTypeLabels: Record<WhatsappMessageType, string> = {
  text: "Mensagem",
  image: "Foto",
  video: "Vídeo",
  gif: "GIF",
  audio: "Áudio",
  ptt: "Mensagem de voz",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  reaction: "Reação",
  poll: "Enquete",
  system: "Aviso",
  unsupported: "Mensagem",
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
  // Número completo manda no corte: 9 dígitos partem em 5, 8 dígitos em 4. A heurística do "9"
  // vale só enquanto se digita — ela existe para o hífen não dançar ((43) 99841 em vez de
  // (43) 9-9841), mas sozinha erra em 8 dígitos começando com 9, que é o formato que o WhatsApp
  // entrega quando o número não tem o nono dígito: 9111-2222 virava 91112-222.
  const cut = rest.length >= 8 ? rest.length - 4 : rest.startsWith("9") ? 5 : 4;
  if (rest.length <= cut) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`;
};

export const toE164 = (value: string | null | undefined) => {
  const digits = phoneNationalDigits(value);
  return digits ? `+55${digits}` : undefined;
};

/**
 * Link de conversa no WhatsApp. O `wa.me` quer só dígitos com DDI e **sem** o `+`.
 *
 * Existe para o `55` não ficar concatenado à mão em cada tela: `phoneNationalDigits` já tira o DDI
 * quando ele vem, então montar `wa.me/55${digits}` fora daqui erra assim que alguém passar o
 * telefone completo em vez do nacional.
 */
export const whatsappUrl = (value: string | null | undefined) => {
  const e164 = toE164(value);
  return e164 ? `https://wa.me/${e164.slice(1)}` : undefined;
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

// KPI de painel: "R$ 10,5 mi" cabe no card, "R$ 10.514.550,00" não. O valor exato continua no
// funil e na tela de negócios; aqui o que importa é a ordem de grandeza.
export const formatCurrencyCompact = (value: string | number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(Number(value));

// Verbo em 3ª pessoa: a frase montada é "<Ator> <verbo> o <substantivo> <rótulo>".
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATED: "criou",
  UPDATED: "alterou",
  DELETED: "removeu",
  STAGE_CHANGED: "moveu de estágio",
  OWNER_CHANGED: "trocou o responsável",
  TRANSFERRED: "transferiu",
  REORDERED: "reordenou os estágios",
  NURTURED: "colocou em nutrição",
  REACTIVATED: "reativou",
  ARCHIVED: "arquivou",
  UNARCHIVED: "desarquivou",
  LINKED: "vinculou ao lead",
  UNLINKED: "desvinculou do lead",
  UPLOADED: "anexou",
  DOWNLOADED: "baixou",
  MESSAGE_SENT: "enviou mensagem",
  MESSAGE_DELETED: "apagou mensagem",
  CONNECTED: "conectou",
  DISCONNECTED: "desconectou",
  RESET: "reiniciou",
  SYNCED: "sincronizou",
  WEBHOOK_RECONCILED: "reconfigurou o webhook",
  TEST_MESSAGE_SENT: "enviou mensagem de teste",
  SIGNED_IN: "entrou no sistema",
  SIGNED_OUT: "saiu do sistema",
  MEMBER_ADDED: "adicionou",
  MEMBER_REMOVED: "removeu",
  ROLE_CHANGED: "mudou o papel de",
  INVITED: "convidou",
  INVITE_REVOKED: "cancelou o convite de",
  EXPORTED: "exportou a auditoria de",
  PURGED: "expurgou eventos antigos de",
};

// Os painéis (arquivos, comentários, histórico, linha do tempo) servem lead e negócio; o texto vazio
// precisa dizer de qual. Todos masculinos de propósito: o texto que os usa escreve "deste <substantivo>".
// A tela de auditoria usa os mesmos substantivos na frase do evento, por isso o Record é completo.
export const ENTITY_NOUNS: Record<AuditEntity, string> = {
  CLIENT: "lead",
  DEAL: "negócio",
  PROPERTY: "imóvel",
  ACTIVITY: "registro",
  PIPELINE: "funil",
  STAGE: "estágio",
  COMMENT: "comentário",
  ATTACHMENT: "arquivo",
  CONVERSATION: "atendimento",
  WHATSAPP_MESSAGE: "envio de WhatsApp",
  WHATSAPP_INSTANCE: "número de WhatsApp",
  LEAD_AUTOMATION: "atendimento automático",
  MEMBER: "membro",
  INVITATION: "convite",
  ORGANIZATION: "cadastro da imobiliária",
  SESSION: "acesso",
};

// Rótulo com maiúscula para a coluna "Tipo" da tela de auditoria — ENTITY_NOUNS é para meio de frase.
export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  CLIENT: "Lead",
  DEAL: "Negócio",
  PROPERTY: "Imóvel",
  ACTIVITY: "Atividade",
  PIPELINE: "Funil",
  STAGE: "Estágio",
  COMMENT: "Comentário",
  ATTACHMENT: "Arquivo",
  CONVERSATION: "Conversa",
  WHATSAPP_MESSAGE: "Mensagem",
  WHATSAPP_INSTANCE: "WhatsApp",
  LEAD_AUTOMATION: "Automação",
  MEMBER: "Membro",
  INVITATION: "Convite",
  ORGANIZATION: "Imobiliária",
  SESSION: "Acesso",
};

export const AUDIT_SOURCE_LABELS: Record<AuditSource, string> = {
  USER: "Pessoa",
  AUTOMATION: "Automação",
  WEBHOOK: "WhatsApp",
  SYSTEM: "Sistema",
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
  // a transferência entre funis grava os dois: "Funil: Vendas → Locação" e o estágio de entrada
  pipeline: "Funil",
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
  nurturedAt: "Em nutrição desde",

  // Chaves de `snapshot` e `context` da auditoria: nome de coluna do banco não pode aparecer na
  // tela, e o detalhe do evento mostra esses dois objetos como pares chave/valor.
  phoneMasked: "Telefone",
  emailMasked: "E-mail",
  ownerMasked: "Número conectado",
  isOpen: "Em aberto",
  isGroup: "Grupo",
  isWon: "Estágio de ganho",
  isLost: "Estágio de perda",
  position: "Posição",
  city: "Cidade",
  price: "Preço",
  filename: "Arquivo",
  contentType: "Tipo do arquivo",
  size: "Tamanho",
  direction: "Sentido",
  sentAt: "Enviada em",
  messageCount: "Mensagens",
  firstMessageAt: "Primeira mensagem",
  lastMessageAt: "Última mensagem",
  clientName: "Lead",
  dealTitle: "Negócio",
  pipelineName: "Funil",
  stageName: "Estágio",
  stageCount: "Estágios",
  targetType: "Tipo do alvo",
  targetLabel: "Alvo",
  conversationId: "Conversa",
  messageId: "Id da mensagem",
  ownerJid: "Número conectado",
  role: "Papel",
  deals: "Negócios",
  activities: "Atividades",
  order: "Ordem",
  removed: "Eventos removidos",
  retentionDays: "Retenção (dias)",
  rows: "Linhas",
  filters: "Filtros",
  to: "Destino",
};

// Campos que guardam id: sem tradução o histórico mostra cuid na tela. Quem chama passa o
// `resolveName` (membros, imóveis e clientes da org); id que não resolve é registro já removido.
const ID_FIELDS = new Set(["ownerId", "propertyId", "clientId"]);

// Datas chegam do audit como ISO; sem isto o histórico mostra 2026-07-21T02:59:59.999Z na tela
const DATE_FIELDS = new Set([
  "dueAt",
  "doneAt",
  "nurtureUntil",
  "nurturedAt",
  // do snapshot da auditoria
  "sentAt",
  "firstMessageAt",
  "lastMessageAt",
]);

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
  if (DATE_FIELDS.has(field) && typeof value === "string") {
    return format(parseISO(value), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  }
  if (ID_FIELDS.has(field) && typeof value === "string") return resolveName?.(value) ?? "(removido)";
  return String(value);
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Tamanho de arquivo em pt-BR: 1,4 MB e não 1.4 MB. Espelha `formatBytes` da API, que escreve o
 * mesmo texto nas mensagens de erro de mídia — os dois lados precisam dizer "29,4 MB" igual.
 *
 * Bytes saem inteiros (não existe meio byte); daí para cima, uma casa decimal. O arredondamento é
 * conferido depois de escolher a unidade, senão 1048000 bytes viraria "1024,0 KB".
 */
export const formatFileSize = (bytes: number | null | undefined) => {
  if (bytes == null || !Number.isFinite(bytes)) return "—";

  const negative = bytes < 0;
  let value = Math.abs(bytes);
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (Number(value.toFixed(unit === 0 ? 0 : 1)) >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === 0 ? 0 : 1,
  });
  return `${negative ? "-" : ""}${formatted} ${BYTE_UNITS[unit]}`;
};
