"use client";

import {
  Download,
  Forward,
  MoreVertical,
  Pin,
  PinOff,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ApiError } from "@/lib/api";
import {
  fetchDownloadUrl,
  useDeleteMessage,
  useFavoriteMessage,
  usePinMessage,
} from "@/lib/queries/conversations";
import type { WhatsappMessage } from "@/lib/types";

/**
 * Menu do resto das ações. Responder e reagir ficam de fora de propósito: são as duas frequentes,
 * e escondê-las atrás de um menu custaria um clique em cada mensagem.
 */
export const MessageActions = ({
  conversationId,
  message,
}: {
  conversationId: string;
  message: WhatsappMessage;
}) => {
  const pin = usePinMessage();
  const favorite = useFavoriteMessage();
  const remove = useDeleteMessage();

  const fixada = !!message.pinnedUntil && new Date(message.pinnedUntil) > new Date();
  const favorita = !!message.favoritedAt;
  const temMidia = message.type !== "text" && message.type !== "unsupported";
  const minha = message.direction === "outbound";

  const erro = (err: unknown, fallback: string) =>
    toast.error((err as ApiError)?.message ?? fallback);

  const baixar = async () => {
    try {
      // a URL da bolha abre no navegador; esta vem como anexo
      window.location.href = await fetchDownloadUrl(message.id);
    } catch (e) {
      erro(e, "Não foi possível baixar o arquivo");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Mais ações"
            className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
        }
      >
        <MoreVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={minha ? "end" : "start"}>
        <DropdownMenuItem
          onClick={() =>
            pin.mutate(
              { conversationId, messageId: message.id, pin: !fixada, duration: 30 },
              { onError: (e) => erro(e, "Não foi possível fixar") },
            )
          }
        >
          {fixada ? <PinOff /> : <Pin />}
          {fixada ? "Desafixar" : "Fixar por 30 dias"}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() =>
            favorite.mutate(
              { conversationId, messageId: message.id, favorite: !favorita },
              { onError: (e) => erro(e, "Não foi possível favoritar") },
            )
          }
        >
          {favorita ? <StarOff /> : <Star />}
          {favorita ? "Remover dos favoritos" : "Favoritar no CRM"}
        </DropdownMenuItem>

        {temMidia && (
          <DropdownMenuItem onClick={baixar}>
            <Download />
            Baixar arquivo
          </DropdownMenuItem>
        )}

        {/* encaminhar exige escolher a conversa de destino; a uazapi só tem `forward` no envio */}
        <DropdownMenuItem disabled>
          <Forward />
          Encaminhar (em breve)
        </DropdownMenuItem>

        {minha && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                remove.mutate(
                  { conversationId, messageId: message.id },
                  { onError: (e) => erro(e, "Não foi possível apagar") },
                )
              }
            >
              <Trash2 />
              Apagar para todos
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
