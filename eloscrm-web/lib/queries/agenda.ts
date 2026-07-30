import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AgendaItem } from "@/lib/types";

export type AgendaRange = { from: string; to: string };

export const useAgenda = (range: AgendaRange) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["agenda", org?.id, range],
    queryFn: async () => {
      const { data } = await api.get<AgendaItem[]>("/agenda", { params: range });
      return data;
    },
    enabled: !!org?.id,
  });
};
