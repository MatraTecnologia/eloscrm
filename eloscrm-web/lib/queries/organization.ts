import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { OrgDeletionPreview } from "@/lib/types";

/**
 * Inventário do que a exclusão vai levar.
 *
 * Só o dono recebe (403 para os outros), e a tela só chama quando o diálogo abre: são ~18 contagens
 * no banco, e não faz sentido pagá-las a cada visita a Configurações.
 */
export const useOrgDeletionPreview = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["organization", org?.id, "deletion-preview"],
    queryFn: async () => {
      const { data } = await api.get<OrgDeletionPreview>("/organization/deletion-preview");
      return data;
    },
    enabled: enabled && !!org?.id,
    // o número mostrado é a promessa feita ao dono: buscar de novo a cada abertura evita confirmar
    // uma exclusão com base numa contagem de dez minutos atrás
    staleTime: 0,
  });
};

/** Exclui a imobiliária ativa. `confirm` é o slug digitado, conferido de novo no servidor. */
export const useDeleteOrganization = () =>
  useMutation({
    mutationFn: async (confirm: string) => {
      await api.delete("/organization", { data: { confirm } });
    },
  });
