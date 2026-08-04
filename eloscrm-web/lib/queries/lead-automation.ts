import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { LeadAutomation } from "@/lib/types";

export type LeadAutomationInput = {
  autoCreateClient: boolean;
  autoCreateDeal: boolean;
  pipelineId: string | null;
  stageId: string | null;
  autoAssign: boolean;
  memberUserIds: string[];
};

export const useLeadAutomation = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["lead-automation", org?.id],
    queryFn: async () => {
      const { data } = await api.get<LeadAutomation>("/lead-automation");
      return data;
    },
    enabled: !!org?.id,
  });
};

export const useUpdateLeadAutomation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeadAutomationInput) => {
      const { data } = await api.put<LeadAutomation>("/lead-automation", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-automation"] }),
  });
};
