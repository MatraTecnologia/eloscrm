import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Activity, ActivityType } from "@/lib/types";

/**
 * Atividades de um lead ou de um negócio. `enabled` amarrado ao vínculo: sem ele a API devolveria a
 * agenda inteira da imobiliária dentro da tela de um registro só.
 */
export const useActivities = (filters: { clientId?: string; dealId?: string }) => {
  const { data: org } = useActiveOrganization();
  const linked = filters.clientId ?? filters.dealId;
  return useQuery({
    queryKey: ["activities", org?.id, filters],
    queryFn: async () => {
      const { data } = await api.get<Activity[]>("/activities", { params: filters });
      return data;
    },
    enabled: !!org?.id && !!linked,
  });
};

export type ActivityInput = {
  type: ActivityType;
  description: string;
  clientId?: string | null;
  dealId?: string | null;
  dueAt?: string | null;
  doneAt?: string | null;
};

// Toda mutação mexe nas duas listagens: a agenda (["agenda"]) e a timeline do cliente
// (["activities"]). Invalidar só uma deixa a outra mostrando o estado anterior.
const useInvalidateActivities = () => {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["agenda"] }),
      qc.invalidateQueries({ queryKey: ["activities"] }),
      qc.invalidateQueries({ queryKey: ["timeline"] }),
    ]);
};

export const useCreateActivity = () => {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: async (input: ActivityInput) => {
      const { data } = await api.post<Activity>("/activities", input);
      return data;
    },
    onSuccess: invalidate,
  });
};

export const useUpdateActivity = () => {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<ActivityInput> }) => {
      const { data } = await api.patch<Activity>(`/activities/${id}`, input);
      return data;
    },
    onSuccess: invalidate,
  });
};

export const useDeleteActivity = () => {
  const invalidate = useInvalidateActivities();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/activities/${id}`);
    },
    onSuccess: invalidate,
  });
};
