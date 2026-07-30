import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AuditEntity, Comment } from "@/lib/types";

export const useComments = (entityType: AuditEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["comments", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<Comment[]>("/comments", { params: { entityType, entityId } });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};

export const useCreateComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entityType: AuditEntity; entityId: string; body: string }) => {
      const { data } = await api.post<Comment>("/comments", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

export const useUpdateComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { data } = await api.patch<Comment>(`/comments/${id}`, { body });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

export const useDeleteComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/comments/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};
