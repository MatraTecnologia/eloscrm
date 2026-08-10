"use client";

import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, MessageSquare, MessageSquareX } from "lucide-react";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { useConversation, useConversations, useMarkRead } from "@/lib/queries/conversations";
import type { WhatsappMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConversationHeader } from "./conversation-header";
import { ConversationList } from "./conversation-list";
import { MessageComposer } from "./message-composer";
import { MessageThread } from "./message-thread";
import { CONVERSA_PARAM } from "./params";

const Inbox = () => {
  const { data: org } = useActiveOrganization();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");

  // `history: "push"` porque o botão voltar do celular precisa devolver para a lista, como em
  // qualquer mensageiro; com o `replace` padrão do nuqs ele sairia da tela de conversas inteira.
  const [selecionada, setSelecionada] = useQueryState(CONVERSA_PARAM, { history: "push" });

  // A citação pertence à conversa em que foi escolhida, então ela é guardada junto do id e fica
  // fora do caminho enquanto outra conversa está aberta — voltar para a de origem a traz de volta,
  // como o rascunho por conversa do próprio WhatsApp. Um efeito de limpeza não serviria: a troca
  // agora também vem do botão voltar do navegador e de links de fora, sem passar por setter nenhum.
  const [citacao, setCitacao] = useState<{ conversationId: string; message: WhatsappMessage } | null>(null);
  const respondendo = citacao && citacao.conversationId === selecionada ? citacao.message : null;

  const { conversations, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useConversations({
      q: busca.trim() || undefined,
      unread: filtro === "nao-lidas" || undefined,
      archived: filtro === "arquivadas" || undefined,
    });
  const { data: conversa, isError } = useConversation(selecionada);
  const { mutate: markRead } = useMarkRead();

  // abrir a conversa é o ato de ler: manter o contador aceso deixaria a lista sempre "pendente"
  useEffect(() => {
    if (selecionada) markRead(selecionada);
  }, [selecionada, markRead]);

  // `-m-6` cancela o `p-6` que o layout aplica a todas as páginas: o inbox é a única tela que ocupa
  // a área inteira, como qualquer mensageiro. A altura desconta só o header (3.5rem), porque a
  // margem negativa devolve o espaço vertical que o padding tomava.
  //
  // `dvh` e não `vh`: no celular a barra do navegador entra e sai, e `vh` congela na altura maior —
  // o compositor ficaria abaixo da dobra. `overflow-hidden` é a garantia final de que quem rola é
  // a lista e a thread, nunca a página.
  return (
    <div className="-m-6 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-semibold">Conversas</h1>
        <p className="text-muted-foreground text-sm">
          Mensagens do WhatsApp da imobiliária, ligadas aos leads do funil.
        </p>
      </div>

      {/* `grid-rows-[minmax(0,1fr)]` é o que segura tudo: linha de grid é `auto` por padrão e
          cresce com o conteúdo, então as conversas empurravam a página inteira em vez de rolar
          dentro da coluna. `min-h-0` no pai não basta — quem precisa poder encolher é a linha.
          A regra só define UMA linha, e é de propósito: em tela estreita a lista e a conversa se
          revezam em vez de empilhar, então nunca há uma segunda linha para dimensionar. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[320px_1fr]">
        {/* Estreito mostra uma coisa por vez, como qualquer mensageiro: as duas empilhadas
            deixariam a conversa abaixo da dobra e a lista sem altura para rolar. */}
        <div className={cn("min-h-0", selecionada && "hidden md:block")}>
          <ConversationList
            conversations={conversations}
            isLoading={isLoading && !!org}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={fetchNextPage}
            selectedId={selecionada}
            onSelect={setSelecionada}
            busca={busca}
            onBusca={setBusca}
            filtro={filtro}
            onFiltro={setFiltro}
          />
        </div>

        <div className={cn("flex min-h-0 flex-col", !selecionada && "hidden md:flex")}>
          {/* Preso ao parâmetro, não à conversa carregada: link colado apontando para conversa de
              outra imobiliária resolve em 404 e, se o botão dependesse do dado, o celular ficaria
              com a lista escondida e sem saída. */}
          {selecionada && (
            <button
              type="button"
              onClick={() => setSelecionada(null)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 border-b px-4 py-2 text-sm md:hidden"
            >
              <ArrowLeft className="size-4" />
              Todas as conversas
            </button>
          )}

          {conversa ? (
            <>
              <ConversationHeader conversation={conversa} onDeleted={() => setSelecionada(null)} />
              <MessageThread
                conversationId={conversa.id}
                onReply={(message) => setCitacao({ conversationId: conversa.id, message })}
              />
              <MessageComposer
                conversationId={conversa.id}
                replyTo={respondendo}
                onCancelReply={() => setCitacao(null)}
              />
            </>
          ) : isError ? (
            <Empty className="m-auto">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareX />
                </EmptyMedia>
                <EmptyTitle>Conversa não encontrada</EmptyTitle>
                <EmptyDescription>
                  Ela pode ter sido removida, ou o link ser de outra imobiliária.
                </EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={() => setSelecionada(null)}>
                Ver todas as conversas
              </Button>
            </Empty>
          ) : selecionada ? (
            <div className="flex flex-1 flex-col gap-3 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-full w-full" />
            </div>
          ) : (
            <Empty className="m-auto">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquare />
                </EmptyMedia>
                <EmptyTitle>Selecione uma conversa</EmptyTitle>
                <EmptyDescription>
                  As mensagens recebidas no WhatsApp conectado aparecem aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
};

export default function ConversasPage() {
  // `useQueryState` lê o query string via `useSearchParams`, que empurra a árvore para
  // client-side rendering: sem o boundary o build falha.
  return (
    <Suspense fallback={<div className="-m-6 h-[calc(100dvh-3.5rem)]" />}>
      <Inbox />
    </Suspense>
  );
}
