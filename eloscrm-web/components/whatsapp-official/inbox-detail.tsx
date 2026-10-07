"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ApiError } from "@/lib/api";
import { useInboxRefresh } from "@/lib/queries/inbox";
import { useClients } from "@/lib/queries/clients";
import type { InboxGroup, InboxMessage } from "@/lib/messaging-types";
import { MessageComposer } from "@/app/(app)/conversas/message-composer";
import { OfficialComposer } from "./official-composer";
import { InboxThread } from "./inbox-thread";

export const InboxDetail = ({ group, onLinked }: { group: InboxGroup; onLinked: (id: string) => void }) => {
  const refresh = useInboxRefresh();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channel = group.channels.find(item => item.conversationId === selectedId) ?? group.channels.find(item => item.provider === "cloud_api") ?? group.channels[0]!;
  const [replyTo, setReplyTo] = useState<InboxMessage | null>(null);
  const [exceptionConfirmed, setExceptionConfirmed] = useState(false);
  const [clientId, setClientId] = useState("");
  const [linking, setLinking] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const clients = useClients({ q: clientSearch || undefined, status: "ALL" }, showLink && !group.clientId);
  const official = group.channels.find(item => item.provider === "cloud_api");
  const markKey = `${group.id}:${group.unreadCount}`;
  useEffect(() => { if (group.unreadCount) void api.post(`/whatsapp/inbox/${encodeURIComponent(group.id)}/read`, {}).catch(() => {}); }, [markKey, group.id, group.unreadCount]);
  const link = async () => {
    if (!official || linking) return;
    setLinking(true);
    try { const result = await api.post<{ id: string }>(`/whatsapp/inbox/conversations/${official.conversationId}/link-client`, { clientId: clientId.trim() }); refresh(); onLinked(result.data.id); }
    catch (error) { toast.error((error as ApiError).message); }
    finally { setLinking(false); }
  };
  return <>
    <div className="shrink-0 space-y-2 border-b p-3">
      <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h2 className="truncate font-semibold">{group.name}</h2><p className="text-xs text-muted-foreground">{group.channels.length} {group.channels.length === 1 ? "canal" : "canais"} neste atendimento</p></div>
        {group.clientId ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/clients/${group.clientId}`} />}>Ver lead</Button> : official ? <Button variant="outline" size="sm" onClick={() => setShowLink(!showLink)}>Vincular lead</Button> : null}
      </div>
      {showLink && !group.clientId && <div className="space-y-2"><Input aria-label="Buscar lead para vincular" placeholder="Buscar lead pelo nome ou telefone" value={clientSearch} onChange={event => setClientSearch(event.target.value)} disabled={linking} /><div className="flex gap-2"><select aria-label="Lead existente" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={clientId} onChange={event => setClientId(event.target.value)} disabled={linking}><option value="">Selecione o lead</option>{clients.data?.slice(0, 50).map(client => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` · ${client.phone}` : ""}</option>)}</select><Button onClick={link} disabled={!clientId.trim() || linking}>Vincular</Button></div><p className="text-xs text-muted-foreground">O vínculo reúne o histórico deste contato com o lead selecionado.</p></div>}
      <label className="flex items-center gap-2 text-xs">Enviar por<select aria-label="Canal de envio" value={channel.conversationId} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" onChange={event => { setSelectedId(event.target.value); setExceptionConfirmed(false); }}>
        {group.channels.map(item => <option key={item.conversationId} value={item.conversationId}>{item.provider === "cloud_api" ? "Oficial" : "uazapi"} · {item.number ?? item.label}</option>)}
      </select></label>
      {channel.provider === "uazapi" && <Link className="inline-block text-xs text-primary underline" href={`/conversas?view=legacy&conversa=${encodeURIComponent(channel.conversationId)}`}>Abrir ações da conversa uazapi</Link>}
    </div>
    <InboxThread group={group} onReply={message => { setReplyTo(message); setSelectedId(message.conversationId); setExceptionConfirmed(false); }} />
    {channel.provider === "cloud_api" ? <OfficialComposer key={channel.conversationId} channel={channel} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} /> : exceptionConfirmed ?
      <><p className="shrink-0 border-t px-3 pt-2 text-xs text-muted-foreground">Envio pela exceção uazapi · {channel.number ?? channel.label}</p><MessageComposer key={channel.conversationId} conversationId={channel.conversationId} replyTo={replyTo?.conversationId === channel.conversationId ? replyTo : null} onCancelReply={() => setReplyTo(null)} /></> :
      <div className="shrink-0 space-y-2 border-t p-3"><p className="text-sm">A uazapi usa um número separado. Confirme o uso deste canal para responder.</p><Button variant="outline" onClick={() => setExceptionConfirmed(true)}>Usar uazapi neste atendimento</Button></div>}
  </>;
};
