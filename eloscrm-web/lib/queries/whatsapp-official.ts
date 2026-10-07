import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { ChannelConnection, OfficialOnboardingConfig, OfficialSyncRequest } from "@/lib/types";

export const useOfficialConnections = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-official", org?.id, "connections"], enabled: !!org?.id,
    queryFn: async () => (await api.get<ChannelConnection[]>("/whatsapp/connections")).data.filter(connection => connection.provider === "cloud_api"), refetchInterval: 5000,
  });
};
export const useOfficialOnboardingConfig = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-official", org?.id, "config"], enabled: !!org?.id && enabled,
    queryFn: async () => (await api.get<OfficialOnboardingConfig>("/whatsapp/onboarding/config")).data,
  });
};
export const useOfficialSyncStatus = (connectionId: string, enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-official", org?.id, "sync", connectionId], enabled: !!org?.id && enabled,
    queryFn: async () => (await api.get<OfficialSyncRequest[]>(`/whatsapp/connections/${connectionId}/sync`)).data, refetchInterval: 5000,
  });
};
