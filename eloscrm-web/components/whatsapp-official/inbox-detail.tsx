"use client";
import { Archive, ArchiveRestore, Search, Trash2, X } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type ApiError } from "@/lib/api";
import { useInboxRefresh } from "@/lib/queries/inbox";
import { useClients } from "@/lib/queries/clients";
import type { InboxGroup, InboxMessage } from "@/lib/messaging-types";
import { ConversationComposer } from "./conversation-composer";
import { InboxThread } from "./inbox-thread";

export const InboxDetail = ({ group, onLinked }: { group: InboxGroup; onLinked: (id: string | null) => void }) => {
  const refresh = useInboxRefresh();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channel = group.channels.find(item => item.conversationId === selectedId) ?? group.channels.find(item => item.provider === "cloud_api") ?? group.channels[0]!;
  const [replyTo, setReplyTo] = useState<InboxMessage | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (action: "archive" | "delete") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "delete") { await api.delete(`/whatsapp/inbox/${encodeURIComponent(group.id)}`); onLinked(null); }
      else await api.post(`/whatsapp/inbox/${encodeURIComponent(group.id)}/archive`, { archived: !group.archived });
      refresh();
      toast.success(action === "delete" ? "Atendimento excluído" : group.archived ? "Atendimento reaberto" : "Atendimento arquivado");
      setDeleting(false);
    } catch (error) { toast.error((error as ApiError).message ?? "Não foi possível concluir a operação"); }
    finally { setBusy(false); }
  };
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
      <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h2 className="truncate font-semibold">{group.name}</h2><p className="text-xs text-muted-foreground">{channel.phone ?? "Contato sem telefone"} · {group.archived ? "Arquivado" : "Ativo"} · {group.channels.length} {group.channels.length === 1 ? "canal" : "canais"}</p></div>
        {group.clientId ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/clients/${group.clientId}`} />}>Ver lead</Button> : official ? <Button variant="outline" size="sm" onClick={() => setShowLink(!showLink)}>Vincular lead</Button> : null}
      </div>
      {showLink && !group.clientId && <div className="space-y-2"><Input aria-label="Buscar lead para vincular" placeholder="Buscar lead pelo nome ou telefone" value={clientSearch} onChange={event => setClientSearch(event.target.value)} disabled={linking} /><div className="flex gap-2"><select aria-label="Lead existente" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={clientId} onChange={event => setClientId(event.target.value)} disabled={linking}><option value="">Selecione o lead</option>{clients.data?.slice(0, 50).map(client => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` · ${client.phone}` : ""}</option>)}</select><Button onClick={link} disabled={!clientId.trim() || linking}>Vincular</Button></div><p className="text-xs text-muted-foreground">O vínculo reúne o histórico deste contato com o lead selecionado.</p></div>}
      {group.channels.length > 1 && <label className="flex items-center gap-2 text-xs">Número do atendimento<select aria-label="Número do atendimento" value={channel.conversationId} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" onChange={event => { setSelectedId(event.target.value); setReplyTo(null); }}>
        {group.channels.map(item => <option key={item.conversationId} value={item.conversationId}>{item.provider === "cloud_api" ? "Oficial" : "uazapi"} · {item.number ?? item.label}</option>)}
      </select></label>}
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setSearching(!searching)}><Search className="size-4" />Buscar mensagens</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act("archive")}>{group.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}{group.archived ? "Reabrir" : "Arquivar"}</Button>
        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setDeleting(true)}><Trash2 className="size-4" />Excluir</Button>
      </div>
      {searching && <div className="flex items-center gap-2"><Input aria-label="Buscar nas mensagens" autoFocus placeholder="Buscar no histórico completo" value={messageSearch} onChange={event => setMessageSearch(event.target.value)} /><Button variant="ghost" size="icon" aria-label="Fechar busca de mensagens" onClick={() => { setSearching(false); setMessageSearch(""); }}><X className="size-4" /></Button></div>}
    </div>
    <InboxThread group={group} search={searching ? messageSearch : ""} onReply={message => { setReplyTo(message); setSelectedId(message.conversationId); }} />
    {channel.provider === "cloud_api" ? <ConversationComposer key={channel.conversationId} channel={channel} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} /> : <p className="shrink-0 border-t p-3 text-sm text-muted-foreground">Histórico da uazapi. Esse canal é reservado aos disparos; selecione o WhatsApp oficial para responder.</p>}
    <AlertDialog open={deleting} onOpenChange={open => { if (!busy) setDeleting(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir atendimento de {group.name}?</AlertDialogTitle><AlertDialogDescription>As conversas e mensagens dos {group.channels.length} canais deste atendimento serão removidas do elosCRM. O lead, os registros de custo e auditoria e o histórico no WhatsApp serão preservados. Essa ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => act("delete")}>{busy ? "Excluindo…" : "Excluir atendimento"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
};
