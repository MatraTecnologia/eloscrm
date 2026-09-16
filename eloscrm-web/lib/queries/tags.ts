import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Tag } from "@/lib/types";

export type TagInput = { name: string; color: string };

export const useTags = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["tags", org?.id],
    queryFn: async () => {
      const { data } = await api.get<Tag[]>("/tags");
      return data;
    },
    enabled: !!org?.id,
  });
};

// os negócios carregam nome e cor da etiqueta desnormalizados: renomear ou apagar uma sem invalidar
// `deals` deixaria o kanban mostrando o chip antigo até o próximo refetch
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["tags"] });
  qc.invalidateQueries({ queryKey: ["deals"] });
  qc.invalidateQueries({ queryKey: ["audit-events"] });
};

export const useCreateTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TagInput) => {
      const { data } = await api.post<Tag>("/tags", input);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useUpdateTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<TagInput> }) => {
      const { data } = await api.patch<Tag>(`/tags/${id}`, input);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useDeleteTag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/tags/${id}`);
    },
    onSuccess: () => invalidate(qc),
  });
};
