import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { MetaIntegration, MetaLead, MetaTokenType } from "@/lib/types";

const key = (orgId?: string) => ["meta", orgId] as const;

export const useMetaIntegration = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: key(org?.id),
    queryFn: async () => {
      const { data } = await api.get<MetaIntegration | null>("/meta/integration");
      return data;
    },
    enabled: !!org?.id,
    // o cron roda a cada minuto; a tela acompanha no mesmo passo para o contador dos formulários
    // e o "última busca" não ficarem parados
    refetchInterval: 60000,
  });
};

export const useMetaLeads = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "leads"],
    queryFn: async () => {
      const { data } = await api.get<MetaLead[]>("/meta/integration/leads", { params: { limit: 100 } });
      return data;
    },
    enabled: !!org?.id && enabled,
    refetchInterval: 60000,
  });
};

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["meta"] });
    // a busca cria leads e negócios: as telas deles precisam refletir
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
};

export const useConnectMeta = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { token: string; tokenType: MetaTokenType }) => {
      const { data } = await api.post<MetaIntegration>("/meta/integration", input);
      return data;
    },
    onSuccess: invalidate,
  });
};

export const useDisconnectMeta = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      await api.delete("/meta/integration");
    },
    onSuccess: invalidate,
  });
};

export const useUpdateMetaSettings = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { pipelineId: string | null; stageId: string | null }) => {
      const { data } = await api.patch<MetaIntegration>("/meta/integration", input);
      return data;
    },
    onSuccess: invalidate,
  });
};

export const useUpdateMetaForm = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      enabled: boolean;
      pipelineId: string | null;
      stageId: string | null;
    }) => {
      const { data } = await api.patch<MetaIntegration>(`/meta/integration/forms/${id}`, input);
      return data;
    },
    onSuccess: invalidate,
  });
};

export const useSyncMetaForms = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<MetaIntegration>("/meta/integration/sync-forms");
      return data;
    },
    onSuccess: invalidate,
  });
};

export const useSyncMetaLeads = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ ingested: number; integration: MetaIntegration }>(
        "/meta/integration/sync",
      );
      return data;
    },
    onSuccess: invalidate,
  });
};
