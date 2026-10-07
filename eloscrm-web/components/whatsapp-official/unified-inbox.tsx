"use client";
import { useEffect, useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { useInboxGroup, useInboxGroups } from "@/lib/queries/inbox";
import { InboxDetail } from "./inbox-detail";
import { cn } from "@/lib/utils";

export const UnifiedInbox = () => {
  const { data: org } = useActiveOrganization();
  const [selected, setSelected] = useQueryState("thread", { history: "push" });
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => { const timer = setTimeout(() => setAppliedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const list = useInboxGroups({ q: appliedSearch || undefined, filter });
  const detail = useInboxGroup(selected);
  const items = useMemo(() => [...new Map((list.data?.pages ?? []).flatMap(page => page.items).map(item => [item.id, item])).values()], [list.data]);
  return <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[320px_1fr]">
    <div className={cn("flex min-h-0 flex-col border-r", selected && "hidden md:flex")}>
      <div className="space-y-2 border-b p-3"><div className="relative"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input aria-label="Buscar atendimento" placeholder="Buscar contato ou telefone" value={search} onChange={event => setSearch(event.target.value)} className="pl-8" /></div><select aria-label="Filtro de atendimentos" value={filter} onChange={event => setFilter(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm"><option value="all">Atendimentos ativos</option><option value="unread">Não lidos</option><option value="archived">Arquivados</option></select></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading && <Skeleton className="m-3 h-20" />}
        {list.isError && <div className="p-3 text-sm" role="alert">Não foi possível carregar os atendimentos.<Button variant="outline" size="sm" onClick={() => list.refetch()}>Tentar novamente</Button></div>}
        {!list.isLoading && !list.isError && !items.length && <p className="p-4 text-sm text-muted-foreground">Nenhum atendimento encontrado.</p>}
        {items.map(item => <button key={item.id} onClick={() => setSelected(item.id)} className={cn("block w-full border-b p-3 text-left hover:bg-muted", selected === item.id && "bg-muted")}><div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{item.name}</span>{item.unreadCount > 0 && <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{item.unreadCount}</span>}</div><p className="truncate text-xs text-muted-foreground">{[...new Set(item.channels.map(channel => channel.provider === "cloud_api" ? "Oficial" : "uazapi"))].join(" · ")}</p><p className="truncate text-sm text-muted-foreground">{item.lastMessageText ?? "Mensagem com mídia ou atendimento sem mensagens"}</p></button>)}
        {list.hasNextPage && <Button className="m-3" variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Carregar mais</Button>}
      </div>
    </div>
    <div className={cn("flex min-h-0 min-w-0 flex-col", !selected && "hidden md:flex")}>
      {selected && <Button className="justify-start rounded-none border-b md:hidden" variant="ghost" onClick={() => setSelected(null)}><ArrowLeft className="size-4" />Todos os atendimentos</Button>}
      {detail.data ? <InboxDetail key={`${org?.id}:${detail.data.id}`} group={detail.data} onLinked={setSelected} /> : detail.isError ? <div className="m-auto p-4 text-center" role="alert"><p>Atendimento não encontrado nesta imobiliária.</p><Button variant="outline" onClick={() => setSelected(null)}>Voltar à lista</Button></div> : selected ? <Skeleton className="m-4 h-32" /> : <p className="m-auto p-4 text-sm text-muted-foreground">Selecione um contato para consultar o histórico e responder.</p>}
    </div>
  </div>;
};
