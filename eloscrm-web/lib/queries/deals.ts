import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { usePipelines } from "@/lib/queries/pipelines";
import type { Deal } from "@/lib/types";

// `null` nos opcionais é o que limpa o campo na API; `undefined` só omite do PATCH e não apaga nada
export type DealInput = {
  title: string;
  clientId: string;
  pipelineId: string;
  stageId: string;
  value?: number | null;
  propertyId?: string | null;
  ownerId?: string | null;
  lostReason?: string | null;
};

export const useDeals = (pipelineId: string | undefined) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["deals", org?.id, pipelineId],
    queryFn: async () => {
      const { data } = await api.get<Deal[]>("/deals", { params: { pipelineId } });
      return data;
    },
    enabled: !!org?.id && !!pipelineId,
  });
};

export type EnrichedDeal = Deal & {
  stageName: string;
  stageColor: string | null;
  isOpen: boolean;
};

// A API não filtra /deals por clientId, então buscamos todos os negócios da org
// uma única vez e enriquecemos com o estágio (nome/cor/aberto) vindo dos pipelines.
export const useOrgDeals = () => {
  const { data: org } = useActiveOrganization();
  const { data: pipelines, isLoading: loadingPipelines } = usePipelines();

  const dealsQuery = useQuery({
    queryKey: ["deals", org?.id, "all"],
    queryFn: async () => {
      const { data } = await api.get<Deal[]>("/deals");
      return data;
    },
    enabled: !!org?.id,
  });

  const stagesById = new Map((pipelines ?? []).flatMap((p) => p.stages.map((s) => [s.id, s] as const)));

  const deals: EnrichedDeal[] = (dealsQuery.data ?? []).map((deal) => {
    const stage = stagesById.get(deal.stageId);
    return {
      ...deal,
      stageName: stage?.name ?? "—",
      stageColor: stage?.color ?? null,
      isOpen: stage ? !stage.isWon && !stage.isLost : false,
    };
  });

  // isLoading e não isPending: sem organização ativa as queries ficam desabilitadas e isPending
  // continua true para sempre, prendendo a UI em skeleton
  return { deals, isLoading: dealsQuery.isLoading || loadingPipelines };
};

// Toda escrita em negócio gera evento de auditoria e entra na linha do tempo dele: sem invalidar as
// três keys, as abas Histórico e Resumo do modal mostram o estado de antes da edição.
const invalidateDealViews = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["deals"] });
  qc.invalidateQueries({ queryKey: ["audit-events"] });
  qc.invalidateQueries({ queryKey: ["timeline"] });
  // as atividades do negócio cascateiam no delete: sem isto, a agenda e a aba Atividades seguem
  // listando atividade de negócio que não existe mais
  qc.invalidateQueries({ queryKey: ["activities"] });
  qc.invalidateQueries({ queryKey: ["agenda"] });
};

export const useCreateDeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DealInput) => {
      const { data } = await api.post<Deal>("/deals", input);
      return data;
    },
    onSuccess: () => invalidateDealViews(qc),
  });
};

export const useUpdateDeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<DealInput> }) => {
      const { data } = await api.patch<Deal>(`/deals/${id}`, input);
      return data;
    },
    // Optimistic move entre estágios (mesmo pipeline): atualiza o cache antes da resposta.
    onMutate: async ({ id, input }) => {
      if (!input.stageId) return { snapshots: [] as [readonly unknown[], Deal[] | undefined][] };
      await qc.cancelQueries({ queryKey: ["deals"] });
      const snapshots = qc.getQueriesData<Deal[]>({ queryKey: ["deals"] });
      for (const [key, deals] of snapshots) {
        if (!deals) continue;
        qc.setQueryData<Deal[]>(
          key,
          deals.map((d) => (d.id === id ? { ...d, stageId: input.stageId as string } : d)),
        );
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, deals]) => qc.setQueryData(key, deals));
    },
    onSettled: () => invalidateDealViews(qc),
  });
};

export const useDeleteDeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/deals/${id}`);
    },
    onSuccess: () => invalidateDealViews(qc),
  });
};
