import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Deal, DealStage } from "@/lib/types";

export type DealInput = {
  title: string;
  clientId: string;
  propertyId?: string;
  value?: number;
  stage?: DealStage;
};

export const useDeals = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["deals", org?.id],
    queryFn: async () => {
      const { data } = await api.get<Deal[]>("/deals");
      return data;
    },
    enabled: !!org?.id,
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
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ["deals"] });
      const previous = qc.getQueriesData<Deal[]>({ queryKey: ["deals"] });
      previous.forEach(([queryKey, deals]) => {
        if (!deals) return;
        qc.setQueryData<Deal[]>(
          queryKey,
          deals.map((deal) =>
            deal.id === id
              ? { ...deal, ...input, value: input.value != null ? String(input.value) : deal.value }
              : deal,
          ),
        );
      });
      return { previous };
    },
    onError: (_err, _variables, context) => {
      context?.previous.forEach(([queryKey, deals]) => qc.setQueryData(queryKey, deals));
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
