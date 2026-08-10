import { useMemo } from "react";
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
  const query = useInfiniteQuery({
    queryKey: [...key(org?.id), filters],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const { data } = await api.get<{ items: Conversation[]; nextCursor?: string }>(
        "/whatsapp/conversations",
        { params: { ...filters, ...(pageParam ? { cursor: pageParam } : {}) } },
      );
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!org?.id,
    // Não há realtime no projeto, então a lista se atualiza sozinha. O intervalo cresce com o
    // número de páginas abertas porque **o refetch de uma infinite query refaz todas elas**: em
    // dez páginas, dez requests a cada dez segundos. Quem está no topo — o caso do atendimento,
    // que é onde a mensagem nova chega — continua com a atualização rápida.
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 1) > 1 ? 30_000 : 10_000),
  });

  // Uma conversa que recebe mensagem entre duas buscas sobe de posição e pode voltar numa página
  // que já foi lida: duas linhas com a mesma key quebram a lista no React. Deduplicar aqui é mais
  // barato do que abrir mão da ordem por mensagem mais recente, que é a ordem certa da tela.
  const conversations = useMemo(() => {
    const vistos = new Set<string>();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.items.filter((conversa) => {
        if (vistos.has(conversa.id)) return false;
        vistos.add(conversa.id);
        return true;
      }),
    );
  }, [query.data]);

  return { ...query, conversations };
};

/** Contagem por aba. A listagem é paginada, então o tamanho da página nunca responde "quantas". */
export const useConversationCounts = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "counts"],
    queryFn: async () => {
      const { data } = await api.get<{ all: number; unread: number; archived: number }>(
        "/whatsapp/conversations/counts",
      );
      return data;
    },
    enabled: !!org?.id,
    // acompanha o intervalo da lista: o número ao lado da aba não pode ficar atrás dela
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
    mutationFn: async ({
      conversationId,
      text,
      replyToId,
    }: {
      conversationId: string;
      text: string;
      // id da nossa mensagem citada; a API resolve o id do provedor a partir dele
      replyToId?: string;
    }) => {
      const { data } = await api.post<WhatsappMessage>(
        `/whatsapp/conversations/${conversationId}/messages`,
        { text, replyToId },
      );
      return data;
    },
    // a thread refaz a busca e a mensagem aparece com o status que o servidor gravou; não há
    // otimismo local porque o envio pode ser recusado pelo próprio WhatsApp
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
};

/** Tipos que a API aceita mandar pelo WhatsApp — espelha `WHATSAPP_MEDIA_TYPES` do back. */
export const WHATSAPP_MEDIA_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const MAX_SEND_MEDIA_BYTES = 16 * 1024 * 1024;
export const MAX_SEND_DOCUMENT_BYTES = 64 * 1024 * 1024;

export const maxSendBytesFor = (contentType: string) =>
  contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/")
    ? MAX_SEND_MEDIA_BYTES
    : MAX_SEND_DOCUMENT_BYTES;

/**
 * Três passos, como nos anexos: a API assina, o navegador sobe direto para o storage e só então a
 * mensagem é criada. O arquivo não passa pelo corpo da API em momento nenhum — é o que permite
 * mandar um vídeo sem carregar dezenas de megabytes na memória do servidor.
 */
export const useSendMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      file,
      caption,
      replyToId,
    }: {
      conversationId: string;
      file: File;
      caption?: string;
      replyToId?: string;
    }) => {
      const { data: assinatura } = await api.post<{ uploadUrl: string; key: string }>(
        `/whatsapp/conversations/${conversationId}/media/upload-url`,
        { filename: file.name, contentType: file.type, size: file.size },
      );

      // fetch puro, sem o axios: a URL assinada vai direto ao storage e não leva o cookie da sessão
      const upload = await fetch(assinatura.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type },
      });
      if (!upload.ok) throw new Error("Falha ao subir o arquivo");

      const { data } = await api.post<WhatsappMessage>(
        `/whatsapp/conversations/${conversationId}/messages/media`,
        { key: assinatura.key, filename: file.name, contentType: file.type, caption, replyToId },
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
};

/**
 * Reage a uma mensagem. Emoji vazio remove — é assim que a uazapi modela o "desreagir".
 *
 * Invalida a thread inteira em vez de mexer no cache: o servidor é quem decide se a reação valeu,
 * e o WhatsApp pode recusar.
 */
export const useReactToMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
      emoji,
    }: {
      conversationId: string;
      messageId: string;
      emoji: string;
    }) => {
      const { data } = await api.post<{ emoji: string | null }>(
        `/whatsapp/conversations/${conversationId}/messages/${messageId}/reaction`,
        { emoji },
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
};

/** Fixadas ainda válidas, para a barra do topo. Em query própria: a fixada costuma estar longe. */
export const usePinnedMessages = (conversationId: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: [...key(org?.id), "pinned", conversationId],
    queryFn: async () => {
      const { data } = await api.get<WhatsappMessage[]>(
        `/whatsapp/conversations/${conversationId}/pinned`,
      );
      return data;
    },
    enabled: !!org?.id && !!conversationId,
  });
};

type AcaoInput = { conversationId: string; messageId: string };

export const usePinMessage = () =>
  useConversationMutation(
    async ({ conversationId, messageId, pin, duration }: AcaoInput & { pin: boolean; duration?: 1 | 7 | 30 }) => {
      await api.post(`/whatsapp/conversations/${conversationId}/messages/${messageId}/pin`, {
        pin,
        ...(duration ? { duration } : {}),
      });
    },
  );

export const useFavoriteMessage = () =>
  useConversationMutation(
    async ({ conversationId, messageId, favorite }: AcaoInput & { favorite: boolean }) => {
      await api.post(`/whatsapp/conversations/${conversationId}/messages/${messageId}/favorite`, {
        favorite,
      });
    },
  );

export const useDeleteMessage = () =>
  useConversationMutation(async ({ conversationId, messageId }: AcaoInput) => {
    await api.delete(`/whatsapp/conversations/${conversationId}/messages/${messageId}`);
  });

/** URL de download com `Content-Disposition: attachment` — a da bolha abre no navegador. */
export const fetchDownloadUrl = async (messageId: string) => {
  const { data } = await api.get<{ url: string }>(
    `/whatsapp/conversations/messages/${messageId}/media`,
    { params: { download: 1 } },
  );
  return data.url;
};

export const useArchiveConversation = () =>
  useConversationMutation(async ({ id, archived }: { id: string; archived: boolean }) => {
    await api.post(`/whatsapp/conversations/${id}/${archived ? "archive" : "unarchive"}`);
  });

/** Apaga a conversa do CRM. Não apaga nada no WhatsApp do lead — a API só mexe no nosso banco. */
export const useDeleteConversation = () =>
  useConversationMutation(async (id: string) => {
    await api.delete(`/whatsapp/conversations/${id}`);
  });
