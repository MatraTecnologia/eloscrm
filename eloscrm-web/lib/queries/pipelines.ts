import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Pipeline, PipelineDeletionPreview } from "@/lib/types";
import type { TemplateStage } from "@/lib/pipeline-templates";

export const usePipelines = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["pipelines", org?.id],
    queryFn: async () => {
      const { data } = await api.get<Pipeline[]>("/pipelines");
      return data;
    },
    enabled: !!org?.id,
  });
};

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["pipelines"] });
  qc.invalidateQueries({ queryKey: ["deals"] });
};

export const useCreatePipeline = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; stages?: TemplateStage[] }) => {
      const body = input.stages && input.stages.length > 0 ? input : { name: input.name };
      const { data } = await api.post<Pipeline>("/pipelines", body);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useUpdatePipeline = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data } = await api.patch<Pipeline>(`/pipelines/${id}`, { name });
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

/** O que impede a exclusão do funil. Buscada só quando o diálogo abre, e sem cache. */
export const usePipelineDeletionPreview = (pipelineId: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["pipelines", org?.id, "deletion-preview", pipelineId],
    queryFn: async () => {
      const { data } = await api.get<PipelineDeletionPreview>(
        `/pipelines/${pipelineId}/deletion-preview`,
      );
      return data;
    },
    enabled: !!org?.id && !!pipelineId,
    staleTime: 0,
  });
};

export const useDeletePipeline = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/pipelines/${id}`);
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useAddStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pipelineId,
      input,
    }: {
      pipelineId: string;
      input: { name: string; color?: string; isWon?: boolean; isLost?: boolean };
    }) => {
      const { data } = await api.post(`/pipelines/${pipelineId}/stages`, input);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useUpdateStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: { name?: string; color?: string; isWon?: boolean; isLost?: boolean; position?: number };
    }) => {
      const { data } = await api.patch(`/stages/${id}`, input);
      return data;
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useDeleteStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/stages/${id}`);
    },
    onSuccess: () => invalidate(qc),
  });
};

export const useReorderStages = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pipelineId, stageIds }: { pipelineId: string; stageIds: string[] }) => {
      await api.patch(`/pipelines/${pipelineId}/reorder-stages`, { stageIds });
    },
    onSuccess: () => invalidate(qc),
  });
};
