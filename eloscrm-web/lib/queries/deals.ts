import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Deal } from "@/lib/types";

export type DealInput = {
  title: string;
  clientId: string;
  pipelineId: string;
  stageId: string;
  value?: number;
  propertyId?: string;
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

export const useCreateDeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DealInput) => {
      const { data } = await api.post<Deal>("/deals", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deals"] }),
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });
};

export const useDeleteDeal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/deals/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });
};
