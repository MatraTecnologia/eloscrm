import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Activity, ActivityType } from "@/lib/types";

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
