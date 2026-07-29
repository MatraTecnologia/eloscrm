import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { AuditEntity, AuditEvent } from "@/lib/types";

export const useAuditEvents = (entityType: AuditEntity, entityId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["audit-events", org?.id, entityType, entityId],
    queryFn: async () => {
      const { data } = await api.get<AuditEvent[]>("/audit-events", { params: { entityType, entityId } });
      return data;
    },
    enabled: !!org?.id && !!entityId,
  });
};
