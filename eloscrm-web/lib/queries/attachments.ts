import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AnnotatableEntity, Attachment } from "@/lib/types";

export const useAttachments = (entityType: AnnotatableEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["attachments", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<Attachment[]>("/attachments", { params: { entityType, entityId } });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};

/**
 * Três passos: a API assina, o browser sobe direto no bucket (o binário não passa pelo Fastify) e a
 * API confirma que o objeto chegou. O PUT vai com `fetch` puro porque a URL já carrega a assinatura —
 * o axios do projeto acrescentaria baseURL e credenciais que quebrariam a assinatura.
 */
export const useUploadAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      file,
    }: {
      entityType: AnnotatableEntity;
      entityId: string;
      file: File;
    }) => {
      const { data } = await api.post<{ attachmentId: string; uploadUrl: string }>(
        "/attachments/upload-url",
        { entityType, entityId, filename: file.name, contentType: file.type, size: file.size },
      );

      const put = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("upload falhou");

      const { data: confirmed } = await api.post<Attachment>(
        `/attachments/${data.attachmentId}/confirm`,
      );
      return confirmed;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

export const useDeleteAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/attachments/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

// o link vive 60s: pedir na hora do clique em vez de guardar na lista
export const fetchDownloadUrl = async (id: string) => {
  const { data } = await api.get<{ url: string }>(`/attachments/${id}/download-url`);
  return data.url;
};
