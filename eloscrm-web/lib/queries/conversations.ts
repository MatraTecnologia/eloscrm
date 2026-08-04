import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Client, Conversation, ConversationClient, WhatsappMessage } from "@/lib/types";

const key = (orgId?: string) => ["conversations", orgId] as const;

export type ConversationFilters = {
  q?: string;
  unread?: boolean;
  archived?: boolean;
  /** usado pela aba Conversa na ficha do lead */
  clientId?: string;
};

export const useConversations = (filters: ConversationFilters = {}) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), filters],
    queryFn: async () => {
      const { data } = await api.get<{ items: Conversation[]; nextCursor?: string }>(
        "/whatsapp/conversations",
        { params: filters },
      );
      return data;
    },
    enabled: !!org?.id,
    // não há realtime no projeto: a lista se atualiza sozinha em intervalo curto o bastante para
    // atendimento humano, sem virar polling agressivo
    refetchInterval: 10_000,
  });
};

export const useConversation = (id: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "detail", id],
    queryFn: async () => {
      const { data } = await api.get<Conversation>(`/whatsapp/conversations/${id}`);
      return data;
    },
    enabled: !!org?.id && !!id,
  });
};

/**
 * Thread paginada para trás. A API devolve em ordem cronológica; cada página anterior é prefixada,
 * então o array final continua do mais antigo para o mais novo.
 */
export const useMessages = (conversationId: string | null) => {
  const { data: org } = useActiveOrganization();
  return useInfiniteQuery({
    queryKey: [...key(org?.id), "messages", conversationId],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const { data } = await api.get<{ items: WhatsappMessage[]; nextBefore?: string }>(
        `/whatsapp/conversations/${conversationId}/messages`,
        { params: pageParam ? { before: pageParam } : undefined },
      );
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore,
    enabled: !!org?.id && !!conversationId,
    refetchInterval: 5_000,
  });
};

const useConversationMutation = <TInput, TResult>(fn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
};

export const useMarkRead = () =>
  useConversationMutation(async (id: string) => {
    await api.post(`/whatsapp/conversations/${id}/read`);
  });

export const useCandidates = (conversationId: string | null, enabled: boolean) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "candidates", conversationId],
    queryFn: async () => {
      const { data } = await api.get<ConversationClient[]>(
        `/whatsapp/conversations/${conversationId}/candidates`,
      );
      return data;
    },
    enabled: enabled && !!org?.id && !!conversationId,
  });
};

/** Invalida também `clients`: criar ou ligar lead muda a lista de leads, não só a conversa. */
const useCrmMutation = <TInput, TResult>(fn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });
};

export const useCreateClientFromConversation = () =>
  useCrmMutation(async ({ conversationId, name }: { conversationId: string; name: string }) => {
    const { data } = await api.post<Client>(
      `/whatsapp/conversations/${conversationId}/create-client`,
      { name },
    );
    return data;
  });

export const useLinkClient = () =>
  useCrmMutation(async ({ conversationId, clientId }: { conversationId: string; clientId: string }) => {
    await api.post(`/whatsapp/conversations/${conversationId}/link-client`, { clientId });
  });

export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, text }: { conversationId: string; text: string }) => {
      const { data } = await api.post<WhatsappMessage>(
        `/whatsapp/conversations/${conversationId}/messages`,
        { text },
      );
      return data;
    },
    // a thread refaz a busca e a mensagem aparece com o status que o servidor gravou; não há
    // otimismo local porque o envio pode ser recusado pelo próprio WhatsApp
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
};

export const useArchiveConversation = () =>
  useConversationMutation(async ({ id, archived }: { id: string; archived: boolean }) => {
    await api.post(`/whatsapp/conversations/${id}/${archived ? "archive" : "unarchive"}`);
  });
