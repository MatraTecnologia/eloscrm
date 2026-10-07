import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { CampaignSummary, OfficialCampaign } from "@/lib/campaign-types";

export const useOfficialCampaigns = (pipelineId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-campaigns", org?.id, pipelineId], enabled: !!org?.id,
    queryFn: async () => (await api.get<CampaignSummary[]>("/whatsapp/campaigns", { params: { pipelineId } })).data, refetchInterval: 5000 });
};
export const useOfficialCampaign = (id: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-campaigns", org?.id, "detail", id], enabled: !!org?.id && !!id,
    queryFn: async () => (await api.get<OfficialCampaign>(`/whatsapp/campaigns/${id}`)).data, refetchInterval: 3000 });
};
export const useCampaignAction = () => {
  const qc = useQueryClient(); const { data: org } = useActiveOrganization();
  return useMutation({ mutationFn: async ({ id, action, previewHash }: { id: string; action: "start" | "refresh" | "cancel"; previewHash?: string }) => (await api.post<OfficialCampaign>(`/whatsapp/campaigns/${id}/${action}`, previewHash ? { previewHash } : {})).data,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["whatsapp-campaigns", org?.id] }); void qc.invalidateQueries({ queryKey: ["whatsapp-inbox", org?.id] }); } });
};
