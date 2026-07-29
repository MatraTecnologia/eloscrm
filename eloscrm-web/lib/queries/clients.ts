import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Client, ClientSource } from "@/lib/types";

export type ClientFilters = { source?: ClientSource; q?: string };
export type ClientInput = {
  name: string;
  email?: string;
  phone?: string;
  source?: ClientSource;
  notes?: string;
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
    },
  });
};
