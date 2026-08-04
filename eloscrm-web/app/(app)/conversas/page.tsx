"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useActiveOrganization } from "@/lib/auth-client";
import { useConversation, useConversations, useMarkRead } from "@/lib/queries/conversations";
import { ConversationHeader } from "./conversation-header";
import { ConversationList } from "./conversation-list";
import { MessageComposer } from "./message-composer";
import { MessageThread } from "./message-thread";

export default function ConversasPage() {
  const { data: org } = useActiveOrganization();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [selecionada, setSelecionada] = useState<string | null>(null);

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
  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-semibold">Conversas</h1>
        <p className="text-muted-foreground text-sm">
          Mensagens do WhatsApp da imobiliária, ligadas aos leads do funil.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        <ConversationList
          conversations={data?.items}
          isLoading={isLoading && !!org}
          selectedId={selecionada}
          onSelect={setSelecionada}
          busca={busca}
          onBusca={setBusca}
          filtro={filtro}
          onFiltro={setFiltro}
        />

        <div className="flex min-h-0 flex-col">
          {conversa ? (
            <>
              <ConversationHeader conversation={conversa} />
              <MessageThread conversationId={conversa.id} />
              <MessageComposer conversationId={conversa.id} />
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
