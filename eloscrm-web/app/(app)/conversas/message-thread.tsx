"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages } from "@/lib/queries/conversations";
import type { WhatsappMessage } from "@/lib/types";
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

// Teto do "carregar até achar". O limite não é de paciência, é de custo permanente: o
// `refetchInterval` do `useMessages` refaz TODAS as páginas carregadas a cada 5s, então cada página
// que o salto abre fica sendo repuxada enquanto a conversa estiver na tela. Três páginas (~120
// mensagens) cobrem a citação de qualquer conversa em andamento, que é o caso real — ninguém
// responde uma mensagem de 400 atrás.
const MAX_PAGINAS = 3;

export const MessageThread = ({
  conversationId,
  onReply,
}: {
  conversationId: string;
  onReply?: (message: WhatsappMessage) => void;
}) => {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(conversationId);
  const fimRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const [destacada, setDestacada] = useState<string | null>(null);

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

  const nodeDe = (id: string) =>
    listaRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`) ?? null;

  /**
   * Salta para a mensagem citada, como o clique na citação do WhatsApp.
   *
   * A API resolve a citação contra o banco inteiro, não só contra o lote carregado — então o
   * bloco pode apontar para algo que ainda não está na tela, e é preciso paginar para trás até
   * encontrar. O alvo é sempre mais antigo que a resposta, então a direção é a mesma do
   * "carregar mensagens anteriores".
   */
  const irAte = async (id: string) => {
    if (!nodeDe(id)) {
      let achou = false;
      let temMais = hasNextPage;
      for (let pagina = 0; !achou && temMais && pagina < MAX_PAGINAS; pagina++) {
        const r = await fetchNextPage();
        temMais = r.hasNextPage;
        achou = r.data?.pages.some((p) => p.items.some((m) => m.id === id)) ?? false;
      }
      if (!achou) {
        toast.error("A mensagem respondida está muito atrás nesta conversa");
        return;
      }
    }
    setDestacada(id);
  };

  useEffect(() => {
    if (!destacada) return;
    // o nó já existe: `destacada` só é marcado depois que a página com a mensagem entrou no cache,
    // e o React pinta antes de rodar o efeito
    nodeDe(destacada)?.scrollIntoView({ block: "center", behavior: "smooth" });
    // o realce é um piscar de reconhecimento, não um estado — sai sozinho
    const t = setTimeout(() => setDestacada(null), 2000);
    return () => clearTimeout(t);
  }, [destacada]);

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
    <div ref={listaRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
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
        <div key={message.id} data-message-id={message.id} className="flex flex-col gap-2">
          {mostrarDia && (
            <span className="text-muted-foreground bg-muted mx-auto rounded-full px-3 py-0.5 text-xs">
              {dia}
            </span>
          )}
          <MessageBubble
            message={message}
            onReply={onReply}
            onJumpTo={irAte}
            highlight={destacada === message.id}
          />
        </div>
      ))}

      {mensagens.length === 0 && (
        <p className="text-muted-foreground m-auto text-sm">Nenhuma mensagem nesta conversa.</p>
      )}

      <div ref={fimRef} />
    </div>
  );
};
