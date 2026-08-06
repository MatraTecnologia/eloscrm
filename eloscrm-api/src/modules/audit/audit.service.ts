import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { forbidden, httpError } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import * as repo from "./audit.repo.js";
import type { ListAuditQuery } from "./audit.schema.js";

/** Teto do CSV. Acima disso o arquivo deixa de ser consultável e a resposta pede filtro melhor. */
const EXPORT_MAX_ROWS = 50_000;

/**
 * Busca global expõe a ação de **todos** os corretores, então é de gestor. O histórico de uma entidade
 * é do dia a dia e continua aberto a qualquer membro — é o que alimenta a aba Histórico do lead.
 *
 * A checagem fica aqui, e não como guard no arquivo de rota, justamente porque as duas leituras
 * dividem a mesma rota.
 */
const requireGlobalAccess = async (orgId: string, filters: ListAuditQuery, actor: Actor) => {
  if (filters.entityId) return;
  if (!(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só gestores podem consultar a auditoria da imobiliária");
  }
};

export const list = async (orgId: string, filters: ListAuditQuery, actor: Actor) => {
  await requireGlobalAccess(orgId, filters, actor);
  return repo.listEvents(orgId, filters);
};

export const actors = async (orgId: string, actor: Actor) => {
  if (!(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só gestores podem consultar a auditoria da imobiliária");
  }
  return repo.listActors(orgId);
};

const CSV_HEADER = [
  "data",
  "ator",
  "email",
  "origem",
  "tipo",
  "item",
  "item_id",
  "acao",
  "alteracoes",
  "contexto",
] as const;

/** `"` dobrado e campo entre aspas: é o que mantém um rótulo com `;` ou vírgula numa coluna só. */
const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export const exportCsv = async (orgId: string, filters: ListAuditQuery, actor: Actor) => {
  if (!(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só gestores podem exportar a auditoria da imobiliária");
  }

  const total = await repo.countEvents(orgId, filters);
  if (total > EXPORT_MAX_ROWS) {
    throw httpError(
      409,
      "EXPORT_TOO_LARGE",
      `São ${total} eventos e o limite é ${EXPORT_MAX_ROWS}. Estreite o período ou os filtros.`,
      { total, max: EXPORT_MAX_ROWS },
    );
  }

  const events = await repo.listAllEvents(orgId, filters, EXPORT_MAX_ROWS);
  const linhas = events.map((event) =>
    [
      event.createdAt.toISOString(),
      event.actorName,
      event.actorEmail,
      event.source,
      event.entityType,
      event.entityLabel,
      event.entityId,
      event.action,
      event.changes,
      event.context,
    ]
      .map(csvCell)
      .join(";"),
  );

  // quem exporta a trilha da equipe entra na trilha
  await recordAudit({
    orgId,
    entityType: AuditEntity.ORGANIZATION,
    entityId: orgId,
    action: AuditAction.EXPORTED,
    actor,
    context: { rows: events.length, filters: { ...filters, cursor: undefined } },
  });

  return { csv: [CSV_HEADER.join(";"), ...linhas].join("\n"), rows: events.length };
};
