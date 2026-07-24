import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { DashboardStats } from "@/lib/types";

export const useDashboardStats = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["dashboard-stats", org?.id],
    queryFn: async () => {
      const { data } = await api.get<DashboardStats>("/dashboard/stats");
      return data;
    },
    enabled: !!org?.id,
  });
};
