"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchDownloadUrl, fetchMediaUrl } from "@/lib/queries/conversations";
import { toast } from "sonner";
import type { WhatsappMessage } from "@/lib/types";

/**
 * Foto e vídeo em tela grande.
 *
 * A bolha existe para dar contexto na conversa; ler um comprovante, conferir a planta ou assistir ao
 * vídeo do apartamento é outro momento, e em 288 pixels de altura nenhum deles funciona. Aqui a
 * mídia ocupa a tela, com o download ao lado — que é o que o corretor faz com documento recebido.
 *
 * As setas andam **pelas mídias já carregadas na thread**, não pela conversa inteira: a thread é
 * paginada para trás, e prometer navegação além do que está em memória exigiria carregar página por
 * página com o visualizador aberto.
 */
export const MediaViewer = ({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: WhatsappMessage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) => {
  const message = items[index];
  // A presigned pode ter vencido enquanto a conversa ficava aberta. Guarda o id junto da URL em vez
  // de zerar por efeito ao trocar de mídia: derivado, não sincronizado — a seta para a próxima foto
  // já ignora a URL da anterior sem passar por um render intermediário com a imagem errada.
  const [renovada, setRenovada] = useState<{ id: string; url: string } | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      else if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [index, items.length, onIndex, onClose]);

  if (!message) return null;

  const src = (renovada?.id === message.id ? renovada.url : null) ?? message.mediaUrl ?? undefined;

  // uma tentativa só: se a URL nova também falhar, o arquivo é que não está lá
  const renovar = async () => {
    if (renovada?.id === message.id) return;
    await fetchMediaUrl(message.id)
      .then((url) => setRenovada({ id: message.id, url }))
      .catch(() => toast.error("Não foi possível carregar a mídia"));
  };

  const baixar = async () => {
    setBaixando(true);
    try {
      window.location.href = await fetchDownloadUrl(message.id);
    } catch {
      toast.error("Não foi possível baixar o arquivo");
    } finally {
      setBaixando(false);
    }
  };

  const legenda = message.text?.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de mídia"
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      // clique no fundo fecha; dentro da mídia, não — senão pausar um vídeo fecharia a tela
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 p-3 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {message.mediaFilename ?? (message.type === "video" ? "Vídeo" : "Foto")}
          </p>
          <p className="text-xs opacity-70">
            {format(parseISO(message.sentAt), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
            {items.length > 1 && ` · ${index + 1} de ${items.length}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Baixar"
            disabled={baixando}
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={baixar}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fechar"
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-2 pb-4">
        {items.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Anterior"
            disabled={index === 0}
            className="shrink-0 text-white hover:bg-white/15 hover:text-white disabled:opacity-20"
            onClick={(event) => {
              event.stopPropagation();
              onIndex(index - 1);
            }}
          >
            <ChevronLeft />
          </Button>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-3">
          {message.type === "video" ? (
            <video
              key={message.id}
              src={src}
              controls
              autoPlay
              playsInline
              className="max-h-full min-h-0 max-w-full rounded"
              onClick={(event) => event.stopPropagation()}
              onError={renovar}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={message.id}
              src={src}
              alt={legenda ?? "Mídia da conversa"}
              // `contain`: recortar uma planta ou um comprovante é justamente perder o que interessa
              className="max-h-full min-h-0 max-w-full rounded object-contain"
              onClick={(event) => event.stopPropagation()}
              onError={renovar}
            />
          )}

          {legenda && (
            <p
              className="max-w-2xl shrink-0 text-center text-sm text-white/90"
              onClick={(event) => event.stopPropagation()}
            >
              {legenda}
            </p>
          )}
        </div>

        {items.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Próxima"
            disabled={index === items.length - 1}
            className="shrink-0 text-white hover:bg-white/15 hover:text-white disabled:opacity-20"
            onClick={(event) => {
              event.stopPropagation();
              onIndex(index + 1);
            }}
          >
            <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
};
