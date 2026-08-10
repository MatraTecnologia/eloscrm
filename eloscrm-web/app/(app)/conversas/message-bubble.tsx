"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Ban,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  FileText,
  Mic,
  Pin,
  Play,
  Star,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize, formatMediaDuration } from "@/lib/labels";
import { fetchMediaUrl } from "@/lib/queries/conversations";
import { cn } from "@/lib/utils";
import type { WhatsappMessage } from "@/lib/types";
import { MessageActions } from "./message-actions";
import { QuotedPreview } from "./quoted-preview";
import { ReactionPicker } from "./reaction-picker";
import { VoicePlayer } from "./voice-player";

/** ✓ enviado · ✓✓ entregue · ✓✓ azul lido — só faz sentido no que sai daqui. */
const StatusIcon = ({ message }: { message: WhatsappMessage }) => {
  if (message.direction !== "outbound") return null;
  if (message.status === "failed") return <TriangleAlert className="size-3.5 text-destructive" />;
  if (message.status === "pending") return <Clock className="size-3.5 opacity-60" />;
  if (message.status === "read") return <CheckCheck className="size-3.5 text-sky-500" />;
  if (message.status === "delivered") return <CheckCheck className="size-3.5 opacity-60" />;
  return <Check className="size-3.5 opacity-60" />;
};

/**
 * Enquanto o arquivo não chega, a bolha mostra o `mediaThumb` — o JPEGThumbnail que veio embutido
 * no webhook. `ptt` e `sticker` não têm thumb (ver §2.5 do spec), então caem no fallback próprio.
 */
const MediaContent = ({
  message,
  onOpen,
}: {
  message: WhatsappMessage;
  onOpen?: () => void;
}) => {
  const thumb = message.mediaThumb ? `data:image/jpeg;base64,${message.mediaThumb}` : null;
  // a presigned vive minutos: numa conversa aberta há mais tempo que isso, a URL da thread já
  // venceu. Em vez de recarregar tudo, a bolha troca por uma nova quando a imagem falha — uma vez,
  // porque se a segunda também falhar o problema não é o prazo
  const [renovada, setRenovada] = useState<string | null>(null);
  const imagem = renovada ?? message.mediaUrl;
  const onMediaError = () => {
    if (renovada) return;
    fetchMediaUrl(message.id).then(setRenovada).catch(() => undefined);
  };

  const proporcao =
    message.mediaWidth && message.mediaHeight
      ? { aspectRatio: `${message.mediaWidth} / ${message.mediaHeight}` }
      : undefined;

  if (message.type === "ptt" || message.type === "audio") {
    // ptt não traz thumbnail (§2.5): enquanto o arquivo não chega, o que dá para mostrar é a
    // duração, que veio no próprio webhook
    if (!message.mediaUrl) {
      return (
        <span className="flex items-center gap-1.5 text-xs opacity-70">
          <Mic className="size-3.5" />
          {message.type === "ptt" ? "Mensagem de voz" : "Áudio"}
          {formatMediaDuration(message.mediaDuration) ? ` · ${formatMediaDuration(message.mediaDuration)}` : ""}
        </span>
      );
    }
    return (
      <VoicePlayer
        src={message.mediaUrl}
        duration={message.mediaDuration}
        waveform={message.mediaWaveform}
      />
    );
  }

  if (message.type === "image" || message.type === "sticker") {
    const src = imagem ?? thumb;
    if (!src) {
      return <span className="text-xs opacity-70">{message.type === "sticker" ? "Figurinha" : "Imagem"}</span>;
    }

    const foto = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={message.text ?? "Mídia recebida"}
        // as dimensões vêm no webhook: com elas o espaço já nasce reservado e a thread não pula
        // enquanto as fotos carregam — quem está lendo perderia a posição da rolagem a cada uma
        style={proporcao}
        className={cn(
          "rounded-md",
          // `contain`, não `cover`: recortar uma planta ou um comprovante corta justamente o que
          // o corretor precisa ler
          // teto de largura além do de altura: sem ele uma foto deitada ocupa a bolha inteira e empurra
          // a conversa para fora da tela — o WhatsApp também segura a mídia em torno deste tamanho
          message.type === "sticker" ? "size-32 object-contain" : "max-h-72 w-full max-w-80 object-contain",
          // sem URL final, o que está na tela é a miniatura: o desfoque evita passar por definitiva
          !imagem && "blur-[1px]",
        )}
        onError={onMediaError}
      />
    );

    // figurinha não abre em tela cheia: ela já é pequena por natureza e não há o que ampliar
    if (message.type === "sticker" || !onOpen) return foto;
    return (
      <button type="button" aria-label="Abrir foto" className="block" onClick={onOpen}>
        {foto}
      </button>
    );
  }

  // gif é vídeo mudo em laço, e é assim que o WhatsApp o mostra: toca sozinho na própria bolha
  if (message.type === "gif") {
    if (!imagem) {
      return thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="GIF" className="max-h-72 max-w-80 rounded-md blur-[1px]" />
      ) : (
        <span className="text-xs opacity-70">GIF</span>
      );
    }
    return (
      <video
        src={imagem}
        className="max-h-72 max-w-80 rounded-md"
        autoPlay
        loop
        muted
        playsInline
        onError={onMediaError}
      />
    );
  }

  /**
   * Vídeo não vira player na thread.
   *
   * Uma conversa com cinco vídeos viraria cinco players nativos, cada um buscando os próprios
   * metadados — e nenhum deles se assiste ali, em 288 pixels. A bolha mostra a cena (o thumbnail que
   * já veio no webhook) com o play por cima, e o vídeo abre em tela cheia. Nada é baixado até lá.
   */
  if (message.type === "video") {
    return (
      <button
        type="button"
        aria-label="Abrir vídeo"
        // largura fixa, não `w-full`: o thumbnail do webhook é pequeno e deixaria o cartão do vídeo
        // menor que as fotos da mesma conversa, sem motivo aparente para quem olha
        className="relative block w-80 max-w-full overflow-hidden rounded-md"
        style={proporcao}
        disabled={!onOpen}
        onClick={onOpen}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="max-h-72 w-full object-cover" />
        ) : (
          <span className="bg-background/40 flex h-40 w-64 items-center justify-center" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="size-6 translate-x-px fill-current" />
          </span>
        </span>
        {formatMediaDuration(message.mediaDuration) && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white tabular-nums">
            {formatMediaDuration(message.mediaDuration)}
          </span>
        )}
      </button>
    );
  }

  return (
    <a
      href={message.mediaUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-md border p-2",
        !message.mediaUrl && "pointer-events-none opacity-70",
      )}
    >
      <FileText className="size-5 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm">{message.mediaFilename ?? "Arquivo"}</span>
        <span className="text-xs opacity-70">{formatFileSize(message.mediaSize)}</span>
      </span>
    </a>
  );
};

export const MessageBubble = ({
  message,
  conversationId,
  onReply,
  onJumpTo,
  onReact,
  onOpenMedia,
  highlight,
}: {
  message: WhatsappMessage;
  conversationId: string;
  onReply?: (message: WhatsappMessage) => void;
  /** leva a thread até a mensagem citada, como o clique na citação do WhatsApp */
  onJumpTo?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  /** abre foto e vídeo em tela cheia; ausente, a bolha só exibe */
  onOpenMedia?: () => void;
  highlight?: boolean;
}) => {
  const mine = message.direction === "outbound";
  const apagada = !!message.deletedAt;
  const temMidia = !apagada && message.type !== "text" && message.type !== "unsupported";
  const citada = message.quoted;
  const fixada = !!message.pinnedUntil && new Date(message.pinnedUntil) > new Date();

  const minhaReacao = message.reactions.find((r) => r.mine)?.emoji ?? null;

  // Vale para bolha própria também: a spec da uazapi diz que só dá para reagir a mensagem de
  // outros, mas o WhatsApp aceita. Mensagem sem id no provedor é que não tem como ser endereçada.
  const reagir = onReact && !apagada && message.providerMessageId && (
    <ReactionPicker atual={minhaReacao} onPick={(emoji) => onReact(message.id, emoji)} />
  );

  // sem id no provedor não há o que mandar como `replyid` — é o caso de um envio ainda pendente
  // ou que falhou, e a API recusaria de qualquer forma
  const acoes = !apagada && <MessageActions conversationId={conversationId} message={message} />;

  const responder = onReply && !apagada && message.providerMessageId && (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Responder"
      // invisível até o hover, mas continua na ordem de tabulação: quem navega por teclado
      // encontra o botão pelo foco
      className="size-7 shrink-0 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
      onClick={() => onReply(message)}
    >
      <CornerUpLeft className="size-3.5" />
    </Button>
  );

  return (
    <div className={cn("group flex items-center gap-1", mine ? "justify-end" : "justify-start")}>
      {mine && acoes}
      {mine && responder}
      {mine && reagir}
      <div className={cn("flex max-w-[75%] flex-col", mine && "items-end")}>
      <div
        className={cn(
          "flex flex-col gap-1 rounded-lg px-3 py-2 text-sm transition-shadow",
          mine ? "bg-primary text-primary-foreground" : "bg-muted",
          highlight && "ring-primary ring-offset-background ring-2 ring-offset-2",
        )}
      >
        {apagada ? (
          // a linha fica para a thread não abrir buraco, mas nada do conteúdo chega aqui: a API
          // deixa de servi-lo quando o remetente apaga para todos
          <span className="flex items-center gap-1.5 italic opacity-70">
            <Ban className="size-3.5 shrink-0" />
            Mensagem apagada
          </span>
        ) : (
          <>
            {citada &&
              (onJumpTo ? (
                <button type="button" className="w-full text-left" onClick={() => onJumpTo(citada.id)}>
                  <QuotedPreview quoted={citada} mine={mine} className="hover:brightness-95" />
                </button>
              ) : (
                <QuotedPreview quoted={citada} mine={mine} />
              ))}

            {/* a citação é resolvida no banco inteiro, não só no lote: sem conteúdo aqui, a original
                foi apagada ou é anterior à integração */}
            {!citada && message.quotedId && (
              <span className="border-l-2 py-1 pl-2 text-xs italic opacity-60">
                Mensagem respondida não disponível
              </span>
            )}

            {temMidia && <MediaContent message={message} onOpen={onOpenMedia} />}

            {message.mediaError && (
              <span className="text-xs opacity-70">Mídia indisponível: {message.mediaError}</span>
            )}

            {message.text && <span className="break-words whitespace-pre-wrap">{message.text}</span>}

            {message.type === "unsupported" && !message.text && (
              <span className="text-xs italic opacity-70">Mensagem não suportada</span>
            )}
          </>
        )}

        <span className="flex items-center justify-end gap-1 text-[11px] opacity-70">
          {fixada && <Pin className="size-3" />}
          {message.favoritedAt && <Star className="size-3 fill-current" />}
          {format(parseISO(message.sentAt), "HH:mm")}
          <StatusIcon message={message} />
        </span>

      </div>

      {message.reactions.length > 0 && (
        // pendurado na borda de baixo, como no WhatsApp. Fica na coluna da bolha e não na thread,
        // então a sobreposição é com a própria bolha — nunca com a mensagem seguinte.
        <span
          className="bg-background -mt-2 flex w-fit items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs shadow-sm"
          title={message.reactions
            .map((r) => `${r.emoji} ${r.mine ? "Você" : (r.authorName ?? "Contato")}`)
            .join(", ")}
        >
          {message.reactions.map((r) => (
            <span key={`${r.emoji}-${r.mine}`}>{r.emoji}</span>
          ))}
        </span>
      )}
      </div>
      {!mine && responder}
      {!mine && reagir}
      {!mine && acoes}
    </div>
  );
};
