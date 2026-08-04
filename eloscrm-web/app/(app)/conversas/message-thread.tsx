"use client";

import { useEffect, useMemo, useRef } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages } from "@/lib/queries/conversations";
import { MessageBubble } from "./message-bubble";

const rotuloDoDia = (iso: string) => {
  const data = parseISO(iso);
  const hoje = new Date();
  if (isSameDay(data, hoje)) return "Hoje";
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (isSameDay(data, ontem)) return "Ontem";
  return format(data, "d 'de' MMMM", { locale: ptBR });
};

export const MessageThread = ({ conversationId }: { conversationId: string }) => {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId);
  const fimRef = useRef<HTMLDivElement>(null);

  // páginas anteriores vêm depois na lista do infinite query, mas são mais antigas na conversa.
  // O separador de dia é derivado aqui, comparando com o item anterior — não dá para acumular
  // estado durante o render.
  const mensagens = useMemo(() => {
    const flat = [...(data?.pages ?? [])].reverse().flatMap((p) => p.items);
    return flat.map((message, i) => {
      const dia = rotuloDoDia(message.sentAt);
      const anterior = i > 0 ? rotuloDoDia(flat[i - 1]!.sentAt) : null;
      return { message, dia, mostrarDia: dia !== anterior };
    });
  }, [data]);

  const ultimaId = mensagens.at(-1)?.message.id;
  useEffect(() => {
    // só rola ao chegar mensagem nova; carregar histórico antigo não pode jogar o usuário para baixo
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [ultimaId, conversationId]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="ml-auto h-12 w-56" />
        <Skeleton className="h-20 w-64" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      {hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-auto"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Carregando…" : "Carregar mensagens anteriores"}
        </Button>
      )}

      {mensagens.map(({ message, dia, mostrarDia }) => (
        <div key={message.id} className="flex flex-col gap-2">
          {mostrarDia && (
            <span className="text-muted-foreground bg-muted mx-auto rounded-full px-3 py-0.5 text-xs">
              {dia}
            </span>
          )}
          <MessageBubble message={message} />
        </div>
      ))}

      {mensagens.length === 0 && (
        <p className="text-muted-foreground m-auto text-sm">Nenhuma mensagem nesta conversa.</p>
      )}

      <div ref={fimRef} />
    </div>
  );
};
