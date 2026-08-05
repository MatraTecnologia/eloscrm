"use client";

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
  Star,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { WhatsappMessage } from "@/lib/types";
import { MessageActions } from "./message-actions";
import { QuotedPreview } from "./quoted-preview";
import { ReactionPicker } from "./reaction-picker";

const duracao = (segundos: number | null) => {
  if (!segundos) return null;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

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
const MediaContent = ({ message }: { message: WhatsappMessage }) => {
  const thumb = message.mediaThumb ? `data:image/jpeg;base64,${message.mediaThumb}` : null;

  if (message.type === "ptt" || message.type === "audio") {
    // ptt não traz thumbnail (§2.5): enquanto o arquivo não chega, o que dá para mostrar é a
    // duração, que veio no próprio webhook
    if (!message.mediaUrl) {
      return (
        <span className="flex items-center gap-1.5 text-xs opacity-70">
          <Mic className="size-3.5" />
          {message.type === "ptt" ? "Mensagem de voz" : "Áudio"}
          {duracao(message.mediaDuration) ? ` · ${duracao(message.mediaDuration)}` : ""}
        </span>
      );
    }
    return <audio controls src={message.mediaUrl} className="h-9 max-w-64" />;
  }

  if (message.type === "image" || message.type === "sticker") {
    const src = message.mediaUrl ?? thumb;
    if (!src) {
      return <span className="text-xs opacity-70">{message.type === "sticker" ? "Figurinha" : "Imagem"}</span>;
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={message.text ?? "Mídia recebida"}
        className={cn(
          "rounded-md object-cover",
          message.type === "sticker" ? "size-32" : "max-h-72 max-w-full",
          // sem URL final, o que está na tela é a miniatura: o desfoque evita passar por definitiva
          !message.mediaUrl && "blur-[1px]",
        )}
      />
    );
  }

  if (message.type === "video" || message.type === "gif") {
    if (!message.mediaUrl) {
      const alt = message.type === "gif" ? "GIF" : "Vídeo";
      return thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt={alt} className="max-h-72 max-w-full rounded-md blur-[1px]" />
      ) : (
        <span className="text-xs opacity-70">{alt}</span>
      );
    }
    return (
      <video
        src={message.mediaUrl}
        className="max-h-72 max-w-full rounded-md"
        // gif no WhatsApp é vídeo mudo em laço, sem controles — ver §2.5
        {...(message.type === "gif"
          ? { autoPlay: true, loop: true, muted: true, playsInline: true }
          : { controls: true })}
      />
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
  highlight,
}: {
  message: WhatsappMessage;
  conversationId: string;
  onReply?: (message: WhatsappMessage) => void;
  /** leva a thread até a mensagem citada, como o clique na citação do WhatsApp */
  onJumpTo?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
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

            {temMidia && <MediaContent message={message} />}

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
