import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Client, ClientSource, ClientStatus, LeadTemperature, NurtureReason } from "@/lib/types";

export type ClientFilters = {
  source?: ClientSource;
  q?: string;
  temperature?: LeadTemperature;
  tag?: string;
  // "ALL" não é um ClientStatus: é o valor que a API aceita para não filtrar nada
  status?: ClientStatus | "ALL";
  overdue?: boolean;
};
export type ClientInput = {
  name: string;
  email?: string;
  phone?: string;
  source?: ClientSource;
  notes?: string;
  description?: string | null;
  tags?: string[];
  temperature?: LeadTemperature;
  interestType?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  nurtureReason?: NurtureReason | null;
  nurtureNote?: string | null;
  nurtureUntil?: string | null;
};

export const useClients = (filters?: ClientFilters) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["clients", org?.id, filters ?? {}],
    queryFn: async () => {
      const { data } = await api.get<Client[]>("/clients", { params: filters });
      return data;
    },
    enabled: !!org?.id,
  });
};

export const useClient = (id: string) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["clients", org?.id, "detail", id],
    queryFn: async () => {
      const { data } = await api.get<Client>(`/clients/${id}`);
      return data;
    },
    enabled: !!org?.id && !!id,
  });
};

export const useCreateClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInput) => {
      const { data } = await api.post<Client>("/clients", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
};

export const useUpdateClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<ClientInput> }) => {
      const { data } = await api.patch<Client>(`/clients/${id}`, input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["audit-events"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      qc.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
};

export const useDeleteClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/clients/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["audit-events"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
};

export type DealDecision = { dealId: string; action: "KEEP" | "CLOSE_LOST"; lostStageId?: string };
export type NurtureInput = {
  reason: NurtureReason;
  note?: string;
  until?: string;
  deals?: DealDecision[];
};
export type ReactivateInput = { reopenDealIds?: string[] };

// nutrir/reativar move negócio, muda a listagem, entra na agenda e no painel: invalidar só
// ["clients"] deixaria o kanban e a agenda mostrando o estado anterior
const invalidateNurtureViews = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["clients"] });
  qc.invalidateQueries({ queryKey: ["deals"] });
  qc.invalidateQueries({ queryKey: ["agenda"] });
  qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  qc.invalidateQueries({ queryKey: ["audit-events"] });
  qc.invalidateQueries({ queryKey: ["timeline"] });
};

export const useNurtureClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: NurtureInput }) => {
      const { data } = await api.post<Client>(`/clients/${id}/nurture`, input);
      return data;
    },
    onSuccess: () => invalidateNurtureViews(qc),
  });
};

export const useReactivateClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ReactivateInput }) => {
      const { data } = await api.post<Client>(`/clients/${id}/reactivate`, input);
      return data;
    },
    onSuccess: () => invalidateNurtureViews(qc),
  });
};
