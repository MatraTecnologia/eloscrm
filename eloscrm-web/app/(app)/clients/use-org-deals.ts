"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { usePipelines } from "@/lib/queries/pipelines";
import type { Deal } from "@/lib/types";

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
