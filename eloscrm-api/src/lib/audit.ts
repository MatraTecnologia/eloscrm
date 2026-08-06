import { AuditSource, type AuditAction, type AuditEntity, type Prisma } from "../generated/prisma/client.js";
import { prisma } from "./prisma.js";
import type { Actor } from "./actor.js";

export type Changes = Record<string, { from: unknown; to: unknown }>;

// O changes vai para uma coluna Json e precisa comparar os dois lados na mesma forma. Number e Decimal
// caem os dois em string: `value` chega do Zod como number e do Prisma como Decimal, e sem isso um
// PATCH que não mudou nada apareceria como 500000 -> "500000".
const normalize = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return String(value);
  return value;
};

export const diffFields = (before: Record<string, unknown>, after: Record<string, unknown>): Changes => {
  const changes: Changes = {};
  for (const [field, rawNext] of Object.entries(after)) {
    // undefined é "campo não enviado no PATCH"; null é "limpar o campo" e conta como mudança
    if (rawNext === undefined) continue;
    const from = normalize(before[field]);
    const to = normalize(rawNext);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] = { from, to };
  }
  return changes;
};

export type AuditInput = {
  orgId: string;
  entityType: AuditEntity;
  entityId: string;
  /** Nome do item no momento do fato: é o que mantém o evento legível depois de o dado ser apagado. */
  entityLabel?: string | null;
  action: AuditAction;
  actor: Actor;
  changes?: Changes;
  /** A que o item pertencia (lead, funil, estágio, conversa), desnormalizado. */
  context?: Record<string, unknown>;
  /** Estado no momento do fato — montar com `snapshotOf`, nunca espalhar a entidade. */
  snapshot?: Record<string, unknown>;
};

export const recordAudit = async (input: AuditInput): Promise<void> => {
  // PATCH que não mudou nada não vira linha no histórico — senão a timeline enche de ruído. Só vale
  // quando `changes` foi passado: ARCHIVED, LINKED e afins não têm diff e precisam gravar mesmo assim.
  if (input.changes && Object.keys(input.changes).length === 0) return;

  // sem cache: renomear a imobiliária é caso real (e auditado), então um Map por processo devolveria
  // nome velho. Se aparecer em perfil de latência, o caminho é receber o nome de quem já carregou a org
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { name: true },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: input.orgId,
      organizationName: org?.name ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel ?? null,
      action: input.action,
      source: input.actor.source ?? AuditSource.USER,
      // id vazio é o ator sintético da automação: a coluna guarda null, não uma string que nunca
      // vai casar com um usuário
      actorId: input.actor.id || null,
      actorName: input.actor.name,
      actorEmail: input.actor.email ?? null,
      // Changes usa `unknown` em from/to pra aceitar qualquer valor normalizado; a coluna é Json
      changes: input.changes as Prisma.InputJsonValue | undefined,
      context: input.context as Prisma.InputJsonValue | undefined,
      snapshot: input.snapshot as Prisma.InputJsonValue | undefined,
      ip: input.actor.ip ?? null,
      userAgent: input.actor.userAgent ?? null,
      requestId: input.actor.requestId ?? null,
    },
  });
};
