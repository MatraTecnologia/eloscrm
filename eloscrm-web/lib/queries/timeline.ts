import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { TimelineItem } from "@/lib/types";

export const useClientTimeline = (clientId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["timeline", org?.id, "client", clientId],
    queryFn: async () => {
      const { data } = await api.get<TimelineItem[]>(`/clients/${clientId}/timeline`);
      return data;
    },
    enabled: !!org?.id && !!clientId,
  });
};
