import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AuditActor, AuditAction, AuditEntity, AuditSearchResult, AuditSource } from "@/lib/types";

export const useAuditEvents = (entityType: AuditEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["audit-events", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<AuditSearchResult>("/audit-events", {
        params: { entityType, entityId },
      });
      return data.items;
    },
    enabled: !!org?.id && !!entityId,
  });
};

export type AuditSearchFilters = {
  entityType?: AuditEntity[];
  /**
   * Restringe a um item. Com ele a API libera a leitura para qualquer membro (é o histórico da
   * entidade); sem ele, a busca é global e exige gestor.
   */
  entityId?: string;
  action?: AuditAction[];
  actorId?: string;
  source?: AuditSource;
  /** Agrupa os eventos nascidos da mesma chamada — "ver as N ações desta mesma operação". */
  requestId?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export const useAuditSearch = (filters: AuditSearchFilters, options: { enabled?: boolean } = {}) => {
  const { data: org } = useActiveOrganization();
  return useInfiniteQuery({
    queryKey: ["audit-events", org?.id, "search", filters],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const { data } = await api.get<AuditSearchResult>("/audit-events", {
        params: {
          ...filters,
          // a API aceita `?action=CREATED,DELETED` — junta em CSV para não depender de como o
          // axios serializaria um array (bracket, repetição…)
          entityType: filters.entityType?.length ? filters.entityType.join(",") : undefined,
          action: filters.action?.length ? filters.action.join(",") : undefined,
          cursor: pageParam,
        },
      });
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!org?.id && (options.enabled ?? true),
  });
};

/**
 * Atores que aparecem no log, para o filtro da tela — inclui os sintéticos (Automação, WhatsApp,
 * Sistema). Só gestor pode chamar (a API recusa com 403 fora disso).
 */
export const useAuditActors = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["audit-events", org?.id, "actors"],
    queryFn: async () => {
      const { data } = await api.get<AuditActor[]>("/audit-events/actors");
      return data;
    },
    enabled: !!org?.id,
  });
};

/**
 * URL do CSV com os filtros atuais.
 *
 * `window.open` em vez de fetch: o navegador cuida do download e o cookie de sessão viaja numa
 * navegação de topo. Por isso a URL é montada aqui, e não pelo axios — o interceptor dele
 * desembrulharia a resposta e não haveria arquivo.
 */
export const auditExportUrl = (filters: AuditSearchFilters) => {
  const params = new URLSearchParams();
  const juntar = (chave: string, valor?: string[] | string | number) => {
    if (valor === undefined || valor === null || valor === "") return;
    params.set(chave, Array.isArray(valor) ? valor.join(",") : String(valor));
  };
  juntar("entityType", filters.entityType);
  juntar("action", filters.action);
  juntar("entityId", filters.entityId);
  juntar("actorId", filters.actorId);
  juntar("source", filters.source);
  juntar("requestId", filters.requestId);
  juntar("q", filters.q);
  juntar("from", filters.from);
  juntar("to", filters.to);

  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";
  return `${base}/v1/audit-events/export?${params.toString()}`;
};
