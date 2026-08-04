"use client";

import { Pin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { whatsappMessageTypeLabels } from "@/lib/labels";
import { usePinMessage, usePinnedMessages } from "@/lib/queries/conversations";
import type { WhatsappMessage } from "@/lib/types";

/**
 * Faixa das mensagens fixadas, acima da thread.
 *
 * É o que torna fixar útil: a mensagem fixada costuma estar centenas de linhas atrás, e sem um
 * atalho no topo ela some junto com o resto. Clicar salta até ela, reusando o mesmo caminho do
 * clique na citação de um reply.
 */
export const PinnedBar = ({
  conversationId,
  onJumpTo,
}: {
  conversationId: string;
  onJumpTo: (messageId: string) => void;
}) => {
  const { data } = usePinnedMessages(conversationId);
  const desafixar = usePinMessage();

  if (!data?.length) return null;

  const resumo = (m: WhatsappMessage) =>
    m.text?.trim() || whatsappMessageTypeLabels[m.type];

  return (
    <div className="bg-muted/40 flex flex-col gap-1 border-b px-4 py-2">
      {data.map((m) => (
        <div key={m.id} className="flex items-center gap-2">
          <Pin className="text-muted-foreground size-3.5 shrink-0" />
          <button
            type="button"
            onClick={() => onJumpTo(m.id)}
            className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
          >
            {resumo(m)}
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Desafixar"
            className="size-6 shrink-0"
            onClick={() =>
              desafixar.mutate({ conversationId, messageId: m.id, pin: false })
            }
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
};
