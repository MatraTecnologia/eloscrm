import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Property, PropertyStatus } from "@/lib/types";

export type PropertyFilters = { status?: PropertyStatus; q?: string };
export type PropertyInput = {
  title: string;
  type?: string;
  address?: string;
  price?: number;
  bedrooms?: number;
  area?: number;
  status?: PropertyStatus;
  photos?: string[];
};

export const useProperties = (filters?: PropertyFilters) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["properties", org?.id, filters ?? {}],
    queryFn: async () => {
      const { data } = await api.get<Property[]>("/properties", { params: filters });
      return data;
    },
    enabled: !!org?.id,
  });
};

export const useCreateProperty = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PropertyInput) => {
      const { data } = await api.post<Property>("/properties", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
};

export const useUpdateProperty = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<PropertyInput> }) => {
      const { data } = await api.patch<Property>(`/properties/${id}`, input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
};

export const useDeleteProperty = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/properties/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
};
