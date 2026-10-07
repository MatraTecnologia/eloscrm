import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "@/lib/api";
import type { InboxGroup, InboxMessage, OfficialTemplate } from "@/lib/messaging-types";

export const useInboxGroups = (filters: { q?: string; filter?: string; clientId?: string } = {}) => {
  const { data: org } = useActiveOrganization();
  return useInfiniteQuery({ queryKey: ["whatsapp-inbox", org?.id, "groups", filters], enabled: !!org?.id,
    queryFn: async ({ pageParam }) => (await api.get<{ items: InboxGroup[]; nextCursor?: string }>("/whatsapp/inbox", { params: { ...filters, cursor: pageParam } })).data,
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor, refetchInterval: query => (query.state.data?.pages.length ?? 1) > 1 ? 30_000 : 5000,
  });
};
export const useInboxGroup = (id: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-inbox", org?.id, "group", id], enabled: !!org?.id && !!id, queryFn: async () => (await api.get<InboxGroup>(`/whatsapp/inbox/${encodeURIComponent(id!)}`)).data, refetchInterval: 5000 });
};
export const useInboxMessages = (id: string) => {
  const { data: org } = useActiveOrganization();
  return useInfiniteQuery({ queryKey: ["whatsapp-inbox", org?.id, "messages", id], enabled: !!org?.id,
    queryFn: async ({ pageParam }) => (await api.get<{ items: InboxMessage[]; nextBefore?: string }>(`/whatsapp/inbox/${encodeURIComponent(id)}/messages`, { params: { before: pageParam } })).data,
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextBefore, refetchInterval: query => (query.state.data?.pages.length ?? 1) > 1 ? 15_000 : 3000,
  });
};
export const useInboxRefresh = () => {
  const qc = useQueryClient();
  const { data: org } = useActiveOrganization();
  return () => { void qc.invalidateQueries({ queryKey: ["whatsapp-inbox", org?.id] }); void qc.invalidateQueries({ queryKey: ["conversations", org?.id] }); };
};
export const useSendTemplates = (connectionId: string | null) => {
  const { data: org } = useActiveOrganization();
  return useQuery({ queryKey: ["whatsapp-inbox", org?.id, "templates", connectionId], enabled: !!org?.id && !!connectionId,
    queryFn: async () => (await api.get<OfficialTemplate[]>(`/whatsapp/outbound/connections/${connectionId}/templates`)).data,
  });
};
