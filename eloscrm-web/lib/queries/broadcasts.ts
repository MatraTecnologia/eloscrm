import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type {
  Broadcast,
  BroadcastDetail,
  BroadcastFilters,
  BroadcastPreviewRow,
} from "@/lib/types";

// mutation e não query: as condições mudam a cada clique e o resultado não deve ficar em cache
export const usePreviewBroadcast = () =>
  useMutation({
    mutationFn: async (input: { pipelineId: string; filters: BroadcastFilters }) => {
      const { data } = await api.post<BroadcastPreviewRow[]>("/broadcasts/preview", input);
      return data;
    },
  });

export const useBroadcasts = (pipelineId: string | undefined, enabled = true) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["broadcasts", org?.id, pipelineId],
    queryFn: async () => {
      const { data } = await api.get<Broadcast[]>("/broadcasts", { params: { pipelineId } });
      return data;
    },
    enabled: !!org?.id && !!pipelineId && enabled,
    // enquanto algum roda, a lista acompanha os contadores
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === "RUNNING") ? 4000 : false,
  });
};

export const useBroadcast = (id: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["broadcasts", org?.id, "detail", id],
    queryFn: async () => {
      const { data } = await api.get<BroadcastDetail>(`/broadcasts/${id}`);
      return data;
    },
    enabled: !!org?.id && !!id,
    refetchInterval: (query) => (query.state.data?.status === "RUNNING" ? 3000 : false),
  });
};

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["broadcasts"] });
  qc.invalidateQueries({ queryKey: ["audit-events"] });
  // cada envio vira bolha numa conversa, que pode ter acabado de nascer
  qc.invalidateQueries({ queryKey: ["conversations"] });
};

export const useCreateBroadcast = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pipelineId: string;
      filters: BroadcastFilters;
      dealIds: string[];
      text: string;
    }) => {
      const { data } = await api.post<BroadcastDetail>("/broadcasts", input);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useCancelBroadcast = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<Broadcast>(`/broadcasts/${id}/cancel`);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};
