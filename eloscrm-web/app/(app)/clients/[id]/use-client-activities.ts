"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Activity } from "@/lib/types";

export const useClientActivities = (clientId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["activities", org?.id, { clientId }],
    queryFn: async () => {
      const { data } = await api.get<Activity[]>("/activities", { params: { clientId } });
      return data;
    },
    enabled: !!org?.id && !!clientId,
  });
};
