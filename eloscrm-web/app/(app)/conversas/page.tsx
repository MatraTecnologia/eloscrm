"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useActiveOrganization } from "@/lib/auth-client";
import { useConversation, useConversations, useMarkRead } from "@/lib/queries/conversations";
import type { WhatsappMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConversationHeader } from "./conversation-header";
import { ConversationList } from "./conversation-list";
import { MessageComposer } from "./message-composer";
import { MessageThread } from "./message-thread";

export default function ConversasPage() {
  const { data: org } = useActiveOrganization();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [respondendo, setRespondendo] = useState<WhatsappMessage | null>(null);

  // trocar de conversa descarta a citação: ela aponta para uma mensagem que não está mais na tela
  const selecionar = (id: string) => {
    setSelecionada(id);
    setRespondendo(null);
  };

  const { data, isLoading } = useConversations({
    q: busca.trim() || undefined,
    unread: filtro === "nao-lidas" || undefined,
    archived: filtro === "arquivadas" || undefined,
  });
  const { data: conversa } = useConversation(selecionada);
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
            conversations={data?.items}
            isLoading={isLoading && !!org}
            selectedId={selecionada}
            onSelect={selecionar}
            busca={busca}
            onBusca={setBusca}
            filtro={filtro}
            onFiltro={setFiltro}
          />
        </div>

        <div className={cn("flex min-h-0 flex-col", !selecionada && "hidden md:flex")}>
          {conversa ? (
            <>
              <button
                type="button"
                onClick={() => setSelecionada(null)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 border-b px-4 py-2 text-sm md:hidden"
              >
                <ArrowLeft className="size-4" />
                Todas as conversas
              </button>
              <ConversationHeader conversation={conversa} />
              <MessageThread conversationId={conversa.id} onReply={setRespondendo} />
              <MessageComposer
                conversationId={conversa.id}
                replyTo={respondendo}
                onCancelReply={() => setRespondendo(null)}
              />
            </>
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
}
