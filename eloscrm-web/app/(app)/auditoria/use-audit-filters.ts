"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { parseAsArrayOf, parseAsIsoDateTime, parseAsString, parseAsStringEnum, useQueryStates } from "nuqs";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, AUDIT_SOURCE_LABELS } from "@/lib/labels";
import type { AuditSearchFilters } from "@/lib/queries/audit";
import type { AuditAction, AuditEntity, AuditSource } from "@/lib/types";

const ENTITY_VALUES = Object.keys(AUDIT_ENTITY_LABELS) as AuditEntity[];
const ACTION_VALUES = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];
const SOURCE_VALUES = Object.keys(AUDIT_SOURCE_LABELS) as AuditSource[];

const DEBOUNCE_MS = 300;

const filterParsers = {
  from: parseAsIsoDateTime,
  to: parseAsIsoDateTime,
  entityType: parseAsArrayOf(parseAsStringEnum(ENTITY_VALUES)).withDefault([]),
  action: parseAsArrayOf(parseAsStringEnum(ACTION_VALUES)).withDefault([]),
  actorId: parseAsString,
  source: parseAsStringEnum(SOURCE_VALUES),
  requestId: parseAsString,
  q: parseAsString.withDefault(""),
};

/**
 * Filtros da busca de auditoria, todos na URL — é o que faz um gestor mandar "olha esse filtro"
 * para outro (D11/Task 14).
 *
 * A busca por texto não escreve na URL a cada tecla: `qInput` é o valor exibido no campo
 * (feedback instantâneo) e só vira `filters.q` — o que de fato entra na query key da busca — 300ms
 * depois de parar de digitar. Escrever a cada tecla recarregaria a lista no meio da digitação.
 * O debounce mora no `onChange` (setTimeout), não num `useEffect`: só assim escapa da regra
 * `react-hooks/set-state-in-effect`, que o projeto liga em todo código autoral.
 */
export const useAuditFilters = () => {
  const [filters, setFilters] = useQueryStates(filterParsers, { history: "replace" });
  const [qInput, setQInput] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setQ = useCallback(
    (value: string) => {
      setQInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void setFilters({ q: value || null });
      }, DEBOUNCE_MS);
    },
    [setFilters],
  );

  const clearAll = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQInput("");
    void setFilters(null);
  }, [setFilters]);

  const searchFilters = useMemo<AuditSearchFilters>(
    () => ({
      entityType: filters.entityType.length ? filters.entityType : undefined,
      action: filters.action.length ? filters.action : undefined,
      actorId: filters.actorId ?? undefined,
      source: filters.source ?? undefined,
      requestId: filters.requestId ?? undefined,
      q: filters.q || undefined,
      from: filters.from ? filters.from.toISOString() : undefined,
      to: filters.to ? filters.to.toISOString() : undefined,
    }),
    [filters],
  );

  const hasActiveFilters =
    filters.entityType.length > 0 ||
    filters.action.length > 0 ||
    !!filters.actorId ||
    !!filters.source ||
    !!filters.requestId ||
    !!filters.q ||
    !!filters.from ||
    !!filters.to;

  return { filters, setFilters, qInput, setQ, searchFilters, hasActiveFilters, clearAll };
};
