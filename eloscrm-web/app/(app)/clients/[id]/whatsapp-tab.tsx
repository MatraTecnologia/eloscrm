"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversations } from "@/lib/queries/conversations";
import type { WhatsappMessage } from "@/lib/types";
import { MessageThread } from "@/app/(app)/conversas/message-thread";
import { MessageComposer } from "@/app/(app)/conversas/message-composer";
import { conversaHref } from "@/app/(app)/conversas/params";

/**
 * A conversa do lead dentro da ficha dele — é onde o corretor já está quando pensa no lead. Reusa a
 * thread e o composer do inbox: mesma bolha, mesmo envio, mesmo tratamento de bloqueio.
 */
export const WhatsappTab = ({ clientId }: { clientId: string }) => {
  const { data, isLoading } = useConversations({ clientId });
  const [respondendo, setRespondendo] = useState<WhatsappMessage | null>(null);
  const conversa = data?.items[0];

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  if (!conversa) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquare />
          </EmptyMedia>
          <EmptyTitle>Nenhuma conversa de WhatsApp</EmptyTitle>
          <EmptyDescription>
            Quando este lead mandar mensagem para o número da imobiliária, a conversa aparece aqui.
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" nativeButton={false} render={<Link href="/conversas" />}>
          Ver todas as conversas
        </Button>
      </Empty>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="flex h-[32rem] flex-col p-0">
        {/* A ficha mostra a conversa em meia tela; o inbox é onde se responde de verdade, com a
            lista ao lado e as ações da mensagem. O link carrega o id no query string. */}
        <div className="flex justify-end border-b px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={conversaHref(conversa.id)} />}
          >
            Abrir no inbox
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
        <MessageThread conversationId={conversa.id} onReply={setRespondendo} />
        <MessageComposer
          conversationId={conversa.id}
          replyTo={respondendo}
          onCancelReply={() => setRespondendo(null)}
        />
      </CardContent>
    </Card>
  );
};
