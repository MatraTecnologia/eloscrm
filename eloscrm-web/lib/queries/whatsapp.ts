import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type {
  WhatsappDeletionPreview,
  WhatsappInstance,
  WhatsappLimits,
  WhatsappLog,
  WhatsappWebhookConfig,
  WhatsappWebhookErrors,
} from "@/lib/types";

const key = (orgId?: string) => ["whatsapp", orgId] as const;

export const useWhatsappInstance = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: key(org?.id),
    queryFn: async () => {
      const { data } = await api.get<WhatsappInstance | null>("/whatsapp/instance");
      return data;
    },
    enabled: !!org?.id,
    // enquanto há QR na tela, segundos importam: o código expira e o usuário está com o celular na
    // mão. Conectado, o webhook avisa a mudança e a consulta periódica é só rede de segurança.
    refetchInterval: (query) => {
      const instance = query.state.data;
      if (!instance) return false;
      if (instance.status === "connecting" || instance.qrcode) return 3000;
      return 30000;
    },
  });
};

export const useWhatsappLogs = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "logs"],
    queryFn: async () => {
      const { data } = await api.get<WhatsappLog[]>("/whatsapp/instance/logs");
      return data;
    },
    enabled: enabled && !!org?.id,
  });
};

export const useWhatsappWebhook = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "webhook"],
    queryFn: async () => {
      const { data } = await api.get<WhatsappWebhookConfig[]>("/whatsapp/instance/webhook");
      return data;
    },
    enabled: enabled && !!org?.id,
    retry: false,
  });
};

export const useWhatsappWebhookErrors = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "webhook-errors"],
    queryFn: async () => {
      const { data } = await api.get<WhatsappWebhookErrors>("/whatsapp/instance/webhook/errors");
      return data;
    },
    enabled: enabled && !!org?.id,
    retry: false,
  });
};

export const useWhatsappLimits = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "wa-limits"],
    queryFn: async () => {
      const { data } = await api.get<WhatsappLimits>("/whatsapp/instance/wa-limits");
      return data;
    },
    enabled: enabled && !!org?.id,
    retry: false,
  });
};

const useWhatsappMutation = <TInput, TResult>(fn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
};

export const useCreateWhatsappInstance = () =>
  useWhatsappMutation(async (input: { name?: string }) => {
    const { data } = await api.post<WhatsappInstance>("/whatsapp/instance", input);
    return data;
  });

export const useConnectWhatsapp = () =>
  useWhatsappMutation(async (input: { phone?: string }) => {
    const { data } = await api.post<WhatsappInstance>("/whatsapp/instance/connect", input);
    return data;
  });

export const useDisconnectWhatsapp = () =>
  useWhatsappMutation(async () => {
    const { data } = await api.post<WhatsappInstance>("/whatsapp/instance/disconnect");
    return data;
  });

export const useSyncWhatsapp = () =>
  useWhatsappMutation(async () => {
    const { data } = await api.post<WhatsappInstance>("/whatsapp/instance/sync");
    return data;
  });

export const useResetWhatsapp = () =>
  useWhatsappMutation(async () => {
    await api.post("/whatsapp/instance/reset");
  });

export const useRenameWhatsapp = () =>
  useWhatsappMutation(async (input: { name: string }) => {
    const { data } = await api.patch<WhatsappInstance>("/whatsapp/instance", input);
    return data;
  });

export const useReconcileWhatsappWebhook = () =>
  useWhatsappMutation(async () => {
    await api.post("/whatsapp/instance/webhook/reconcile");
  });

/**
 * O que a remoção da conexão vai levar.
 *
 * Buscada só quando o diálogo abre, e sem cache: o número é a promessa feita ao gestor, e confirmar
 * com uma contagem velha seria pior do que não mostrar nada.
 */
export const useWhatsappDeletionPreview = (enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["whatsapp", org?.id, "deletion-preview"],
    queryFn: async () => {
      const { data } = await api.get<WhatsappDeletionPreview>("/whatsapp/instance/deletion-preview");
      return data;
    },
    enabled: enabled && !!org?.id,
    staleTime: 0,
  });
};

export const useDeleteWhatsappInstance = () =>
  useWhatsappMutation(async () => {
    await api.delete("/whatsapp/instance");
  });

// fora do useWhatsappMutation de propósito: enviar teste não muda estado da instância, então
// invalidar o cache inteiro só provocaria refetch à toa
export const useTestSendWhatsapp = () =>
  useMutation({
    mutationFn: async (input: { number: string; text: string }) => {
      const { data } = await api.post<{ id: string; status: string | null }>(
        "/whatsapp/instance/test-send",
        input,
      );
      return data;
    },
  });
