import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { TimelineItem } from "@/lib/types";

/** Só lead e negócio têm timeline na API; o recurso vira o caminho da rota. */
export type TimelineEntity = "CLIENT" | "DEAL";

const RESOURCES: Record<TimelineEntity, string> = { CLIENT: "clients", DEAL: "deals" };

export const useEntityTimeline = (entityType: TimelineEntity, entityId: string, limit?: number) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["timeline", org?.id, entityType, entityId, limit],
    queryFn: async () => {
      const { data } = await api.get<TimelineItem[]>(`/${RESOURCES[entityType]}/${entityId}/timeline`, {
        params: limit ? { limit } : undefined,
      });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};
