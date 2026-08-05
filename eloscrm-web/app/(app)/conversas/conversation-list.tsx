"use client";

import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConversationCounts } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

type Props = {
  conversations: Conversation[] | undefined;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  busca: string;
  onBusca: (value: string) => void;
  filtro: string;
  onFiltro: (value: string) => void;
};

const titulo = (c: Conversation) =>
  c.client?.name ?? c.contactName ?? c.waName ?? c.phone ?? "Sem nome";

/**
 * Contagem ao lado do nome da aba.
 *
 * Zero não vira badge: um "0" ao lado de "Não lidas" ocupa espaço para dizer que não há nada, e a
 * ausência já diz isso. `undefined` é a contagem ainda carregando.
 */
const Contagem = ({ valor }: { valor: number | undefined }) =>
  valor ? (
    <span className="bg-muted-foreground/15 rounded-full px-1.5 text-[11px] leading-4 tabular-nums">
      {valor > 99 ? "99+" : valor}
    </span>
  ) : null;

export const ConversationList = ({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  busca,
  onBusca,
  filtro,
  onFiltro,
}: Props) => {
  const { data: counts } = useConversationCounts();

  return (
    <div className="flex h-full min-h-0 flex-col border-r">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            placeholder="Buscar conversa"
            className="pl-8"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
          />
        </div>
        <Tabs value={filtro} onValueChange={onFiltro}>
          <TabsList className="w-full">
            <TabsTrigger value="todas" className="flex-1 gap-1.5">
              Todas
              <Contagem valor={counts?.all} />
            </TabsTrigger>
            <TabsTrigger value="nao-lidas" className="flex-1 gap-1.5">
              Não lidas
              <Contagem valor={counts?.unread} />
            </TabsTrigger>
            <TabsTrigger value="arquivadas" className="flex-1 gap-1.5">
              Arquivadas
              <Contagem valor={counts?.archived} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1 scroll-fade">
        {isLoading && (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {conversations?.length === 0 && (
          <p className="text-muted-foreground p-4 text-sm">
            Nenhuma conversa por aqui.
          </p>
        )}

        {conversations?.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "hover:bg-muted/60 flex w-full items-center gap-3 border-b p-3 text-left",
              selectedId === c.id && "bg-muted",
            )}
          >
            <Avatar className="size-10 shrink-0">
              {c.photoUrl && <AvatarImage src={c.photoUrl} alt="" />}
              <AvatarFallback>
                {titulo(c).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {titulo(c)}
                </span>
                {c.lastMessageAt && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatDistanceToNowStrict(parseISO(c.lastMessageAt), {
                      locale: ptBR,
                    })}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground truncate text-xs">
                  {c.lastMessageText ?? "—"}
                </span>
                {c.unreadCount > 0 && (
                  <Badge className="h-5 min-w-5 shrink-0 justify-center px-1.5">
                    {c.unreadCount}
                  </Badge>
                )}
              </div>
              {/* sem lead vinculado é o caso que o corretor precisa agir: virar lead ou escolher */}
              {!c.client && (
                <span className="text-muted-foreground text-[11px] italic">
                  sem lead vinculado
                </span>
              )}
            </div>
          </button>
        ))}
      </ScrollArea>
    </div>
  );
};
