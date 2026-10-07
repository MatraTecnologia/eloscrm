import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "@/lib/api";
import type { CostPeriod, CostRate, CostReport, CostFilters, CostScopes, CostReconciliation } from "@/lib/cost-types";
export const useCostReport = (period: CostPeriod & CostFilters, enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-costs", org?.id, "report", period], enabled: !!org?.id && enabled, queryFn: async () => (await api.get<CostReport>("/whatsapp/costs", { params: period })).data });
};
export const useCostRates = (connectionId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-costs", org?.id, "rates", connectionId], enabled: !!org?.id && !!connectionId, queryFn: async () => (await api.get<CostRate[]>("/whatsapp/costs/rates", { params: { connectionId } })).data });
};

export const useCostScopes = (connectionId: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-costs", org?.id, "scopes", connectionId], enabled: !!org?.id && !!connectionId, queryFn: async () => (await api.get<CostScopes>("/whatsapp/costs/scopes", { params: { connectionId } })).data });
};
export const useCostReconciliations = (period: CostPeriod, enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-costs", org?.id, "reconciliations", period], enabled: !!org?.id && enabled, queryFn: async () => (await api.get<CostReconciliation[]>("/whatsapp/costs/reconciliations", { params: period })).data });
};
