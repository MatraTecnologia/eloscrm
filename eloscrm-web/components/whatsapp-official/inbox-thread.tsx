"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/api";
import { toast } from "sonner";
import { useInboxRefresh } from "@/lib/queries/inbox";
import { MediaViewer } from "@/app/(app)/conversas/media-viewer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageBubble } from "@/app/(app)/conversas/message-bubble";
import { useInboxMessages } from "@/lib/queries/inbox";
import type { InboxGroup, InboxMessage, OfficialSendStatus } from "@/lib/messaging-types";

const statusLabels: Record<OfficialSendStatus, string> = { pending: "Na fila", preparing: "Preparando envio", sending: "Enviando", accepted: "Aceita pela Meta", failed: "Envio recusado", uncertain: "Resultado incerto, sem reenvio automático" };
export const InboxThread = ({ group, onReply }: { group: InboxGroup; onReply: (message: InboxMessage) => void }) => {
  const query = useInboxMessages(group.id);
  const refresh = useInboxRefresh();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const retryMedia = async (id: string) => {
    if (retryingId) return;
    setRetryingId(id);
    try { await api.post(`/whatsapp/official-media/${encodeURIComponent(id)}/retry`, {}); refresh(); }
    catch (error) { toast.error((error as ApiError).message ?? "Não foi possível recuperar a mídia"); }
    finally { setRetryingId(null); }
  };
  const end = useRef<HTMLDivElement>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const messages = useMemo(() => {
    const unique = new Map<string, InboxMessage>();
    for (const page of [...(query.data?.pages ?? [])].reverse()) for (const message of page.items) unique.set(message.id, message);
    return [...unique.values()].sort((left, right) => left.sentAt.localeCompare(right.sentAt) || left.id.localeCompare(right.id));
  }, [query.data]);
  const media = messages.filter(message => !message.deletedAt && !!message.mediaUrl && ["image", "video"].includes(message.type));
  const viewingIndex = media.findIndex(message => message.id === viewingId);
  const latestId = messages.at(-1)?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [latestId]);
  if (query.isLoading) return <div className="min-h-0 flex-1 space-y-3 p-4"><Skeleton className="h-12 w-48" /><Skeleton className="ml-auto h-12 w-48" /></div>;
  if (query.isError) return <div className="p-4" role="alert">Não foi possível carregar o histórico. <Button onClick={() => query.refetch()} variant="outline">Tentar novamente</Button></div>;
  return <div className="min-h-0 flex-1 overflow-y-auto p-4">
    {query.hasNextPage && <div className="mb-4 text-center"><Button variant="outline" size="sm" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Carregar mensagens anteriores</Button></div>}
    {!messages.length && <p className="text-center text-sm text-muted-foreground">Nenhuma mensagem neste atendimento.</p>}
    <div className="space-y-3">{messages.map((message, index) => {
      const channel = group.channels.find(item => item.conversationId === message.conversationId);
      const origin = message.origin === "history" ? "Histórico importado" : message.origin === "business_app" ? "WhatsApp no celular" : message.direction === "outbound" && message.authorName ? `CRM · ${message.authorName}` : channel?.provider === "cloud_api" ? "WhatsApp oficial" : "uazapi";
      const day = new Date(message.sentAt).toLocaleDateString("pt-BR");
      const previousDay = index ? new Date(messages[index - 1]!.sentAt).toLocaleDateString("pt-BR") : null;
      return <div key={message.id} data-message-id={message.id}>
        {day !== previousDay && <p className="my-3 text-center text-xs text-muted-foreground">{day}</p>}
        <p className={`mb-1 text-xs text-muted-foreground ${message.direction === "outbound" ? "text-right" : ""}`}>{origin} · {channel?.number ?? channel?.label}</p>
        <MessageBubble message={message} conversationId={message.conversationId} allowActions={false} onReply={() => onReply(message)} onOpenMedia={() => setViewingId(message.id)} />
        {message.connectionId && message.origin !== "uazapi" && !message.deletedAt && message.mediaStatus === "failed" && <div className="mt-1 flex justify-end"><Button size="sm" variant="outline" disabled={!!retryingId} onClick={() => retryMedia(message.id)}>{retryingId === message.id ? "Recuperando arquivo…" : "Tentar baixar mídia novamente"}</Button></div>}
        {message.command && message.command.status !== "accepted" && <p className={`mt-1 text-xs ${message.command.status === "failed" || message.command.status === "uncertain" ? "text-destructive" : "text-muted-foreground"} text-right`}>{statusLabels[message.command.status]}{message.command.safeError ? ` · ${message.command.safeError}` : ""}</p>}
      </div>;
    })}</div><div ref={end} />
    {viewingIndex >= 0 && <MediaViewer items={media} index={viewingIndex} onIndex={index => setViewingId(media[index]?.id ?? null)} onClose={() => setViewingId(null)} />}
  </div>;
};
