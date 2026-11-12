import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { ChannelConnection, HubConfig, HubConnectSession } from "@/lib/types";

export const useHubConfig = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-hub", org?.id, "config"], enabled: !!org?.id && enabled,
    queryFn: async () => (await api.get<HubConfig>("/whatsapp/hub/config")).data,
  });
};

export const useStartHubSession = () => useMutation({
  mutationFn: async () => (await api.post<HubConnectSession>("/whatsapp/hub/connect-sessions", {})).data,
});

// retorno do hub com status=connected: o backend relê a conexão no hub e aplica
export const useRefreshHubConnection = () => {
  const queryClient = useQueryClient();
  const { data: org } = useActiveOrganization();
  return useMutation({
    mutationFn: async (connectionId: string) => (await api.post<ChannelConnection>(`/whatsapp/hub/connections/${encodeURIComponent(connectionId)}/refresh`, {})).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-official", org?.id] }),
  });
};
