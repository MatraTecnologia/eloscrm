import type { AuditAction, AuditEntity, Prisma } from "../generated/prisma/client.js";
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

export const diffFields = <T extends Record<string, unknown>>(
  before: T,
  after: { [K in keyof T]?: T[K] | null },
): Changes => {
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

export const recordAudit = async (input: {
  orgId: string;
  entityType: AuditEntity;
  entityId: string;
  action: AuditAction;
  actor: Actor;
  changes?: Changes;
}): Promise<void> => {
  // PATCH que não mudou nada não vira linha no histórico — senão a timeline enche de ruído
  if (input.changes && Object.keys(input.changes).length === 0) return;
  await prisma.auditEvent.create({
    data: {
      organizationId: input.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actor.id,
      actorName: input.actor.name,
      // Changes usa `unknown` em from/to pra aceitar qualquer valor normalizado; a coluna é Json
      changes: (input.changes as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });
};
