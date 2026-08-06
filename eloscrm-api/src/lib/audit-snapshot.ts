import { AuditEntity } from "../generated/prisma/client.js";
import { formatBrPhone } from "./phone.js";

/**
 * Telefone mascarado para o log: DDD e os dois últimos dígitos bastam para reconhecer o contato numa
 * disputa, e o resto não precisa sobreviver à exclusão pedida pelo titular.
 *
 *   "(43) 99183-4229" → "(43) *****-**29"
 */
export const maskPhone = (value: string | null | undefined): string | null => {
  const formatted = formatBrPhone(value);
  if (!formatted) return null;
  const total = (formatted.match(/\d/g) ?? []).length;
  // menos de quatro dígitos não é telefone reconhecível, e mascarar devolveria algo sem sentido
  if (total < 4) return "***";

  // preserva a pontuação do formatBrPhone e troca só os dígitos do meio: assim o log continua
  // parecendo um telefone, o que ajuda a reconhecer o contato, sem carregar o número
  let visto = 0;
  return formatted.replace(/\d/g, (digit) => {
    visto += 1;
    const noDdd = visto <= 2;
    const noFinal = visto > total - 2;
    return noDdd || noFinal ? digit : "*";
  });
};

/** "ana.paula@gmail.com" → "an***@gmail.com". Domínio fica: é o que identifica origem sem expor a pessoa. */
export const maskEmail = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const [user, domain] = value.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
};

/**
 * Campos que cada entidade pode copiar para o `snapshot` do evento.
 *
 * Allowlist, nunca `{ ...entity }`: o snapshot sobrevive ao delete, então tudo que entra aqui é dado
 * que continua existindo depois de o registro ser apagado. Telefone e e-mail entram pelos derivados
 * mascarados (`phoneMasked`, `emailMasked`), montados em `snapshotOf`.
 */
const FIELDS: Partial<Record<AuditEntity, readonly string[]>> = {
  [AuditEntity.CLIENT]: ["source", "status", "temperature", "interestType", "phoneMasked", "emailMasked"],
  [AuditEntity.DEAL]: ["value", "stageId", "ownerId", "isOpen", "lostReason"],
  [AuditEntity.PROPERTY]: ["type", "city", "price", "status"],
  [AuditEntity.ACTIVITY]: ["type", "dueAt", "doneAt"],
  [AuditEntity.PIPELINE]: ["position"],
  [AuditEntity.STAGE]: ["position", "isWon", "isLost"],
  [AuditEntity.ATTACHMENT]: ["filename", "contentType", "size"],
  // sem `text` e sem `mediaKey`: conteúdo de conversa não é dado de auditoria
  [AuditEntity.WHATSAPP_MESSAGE]: ["direction", "type", "sentAt"],
  [AuditEntity.CONVERSATION]: ["phoneMasked", "isGroup", "messageCount", "firstMessageAt", "lastMessageAt"],
  [AuditEntity.WHATSAPP_INSTANCE]: ["status", "ownerMasked"],
  [AuditEntity.MEMBER]: ["role"],
  [AuditEntity.INVITATION]: ["role", "emailMasked"],
};

type Row = Record<string, unknown>;

/**
 * Copia da linha só o que a allowlist permite, já com os derivados mascarados.
 *
 * `undefined` some do resultado (o Json da coluna não guarda `undefined`), então campo ausente na linha
 * simplesmente não aparece no snapshot — em vez de virar `null` e mentir que estava vazio.
 */
export const snapshotOf = (entityType: AuditEntity, row: Row): Record<string, unknown> | undefined => {
  const allowed = FIELDS[entityType];
  if (!allowed) return undefined;

  const derived: Row = {
    ...row,
    ...(row.phone !== undefined ? { phoneMasked: maskPhone(row.phone as string | null) } : {}),
    ...(row.email !== undefined ? { emailMasked: maskEmail(row.email as string | null) } : {}),
    ...(row.ownerJid !== undefined ? { ownerMasked: maskPhone(row.ownerJid as string | null) } : {}),
  };

  const snapshot: Record<string, unknown> = {};
  for (const field of allowed) {
    const value = derived[field];
    if (value === undefined) continue;
    // Decimal do Prisma e Date não são JSON: viram string, que é como o front já lê o resto da API
    snapshot[field] = value instanceof Date ? value.toISOString() : normalizeScalar(value);
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
};

const normalizeScalar = (value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? String(value) : value;

/**
 * Rótulo humano da entidade. É o campo que faz o evento continuar legível depois do delete, então a
 * ordem tenta os nomes mais informativos primeiro e cai no `id` só como último recurso.
 */
export const labelOf = (row: Row): string | null => {
  for (const field of ["name", "title", "filename", "description"] as const) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return truncate(value.trim());
  }
  return null;
};

/** Descrição de atividade e comentário são texto livre; o rótulo é uma linha, não um parágrafo. */
export const truncate = (value: string, max = 120) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;
