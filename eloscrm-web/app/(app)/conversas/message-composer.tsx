"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileText, Paperclip, Send, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  WHATSAPP_MEDIA_ACCEPT,
  maxSendBytesFor,
  useSendMedia,
  useSendMessage,
} from "@/lib/queries/conversations";
import { formatFileSize } from "@/lib/labels";
import type { ApiError } from "@/lib/api";
import type { WhatsappMessage } from "@/lib/types";
import { toast } from "sonner";
import { QuotedPreview } from "./quoted-preview";

export const MessageComposer = ({
  conversationId,
  replyTo,
  onCancelReply,
}: {
  conversationId: string;
  replyTo?: WhatsappMessage | null;
  onCancelReply?: () => void;
}) => {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const send = useSendMessage();
  const sendMedia = useSendMedia();

  const enviando = send.isPending || sendMedia.isPending;

  const escolher = (file: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    // a prévia só existe para imagem; o resto se identifica melhor pelo nome do arquivo
    setPreview(file?.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setArquivo(file);
  };

  const selecionar = (file: File | undefined) => {
    if (!file) return;

    // as duas conferências que a API repete: aqui elas evitam um upload que já nasceria recusado
    if (!(WHATSAPP_MEDIA_ACCEPT as readonly string[]).includes(file.type)) {
      toast.error("Tipo de arquivo não suportado pelo WhatsApp");
      return;
    }
    if (file.size > maxSendBytesFor(file.type)) {
      toast.error(`Arquivo grande demais (máximo ${formatFileSize(maxSendBytesFor(file.type))})`);
      return;
    }
    escolher(file);
  };

  const aoFalhar = (err: unknown) => {
    // o interceptor do axios rejeita já com o envelope { code, message } da API, não com Error
    const erro = err as ApiError;
    // limite do próprio WhatsApp não é falha da conexão — merece explicação, não um toast
    if (erro.code === "WHATSAPP_BLOCKED") {
      setBloqueio(erro.message);
      return;
    }
    toast.error(erro.message ?? "Não foi possível enviar");
  };

  // limpa só no sucesso: se falhar, texto e arquivo continuam ali para reenviar
  const aoEnviar = () => {
    setTexto("");
    escolher(null);
    setBloqueio(null);
    onCancelReply?.();
  };

  const enviar = () => {
    if (enviando) return;
    const legenda = texto.trim();

    if (arquivo) {
      sendMedia.mutate(
        { conversationId, file: arquivo, caption: legenda || undefined, replyToId: replyTo?.id },
        { onSuccess: aoEnviar, onError: aoFalhar },
      );
      return;
    }

    if (!legenda) return;
    send.mutate(
      { conversationId, text: legenda, replyToId: replyTo?.id },
      { onSuccess: aoEnviar, onError: aoFalhar },
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t p-3">
      {bloqueio && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>O WhatsApp bloqueou este envio</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-1">
            <span>{bloqueio}</span>
            <Link
              href="/integracoes/whatsapp"
              className="text-sm underline underline-offset-4"
            >
              Ver diagnóstico da conexão
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {replyTo && (
        <div className="flex items-center gap-2">
          <QuotedPreview quoted={replyTo} className="bg-muted min-w-0 flex-1" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cancelar resposta"
            className="size-8 shrink-0"
            onClick={onCancelReply}
          >
            <X />
          </Button>
        </div>
      )}

      {arquivo && (
        <div className="bg-muted flex items-center gap-3 rounded-md p-2">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-12 shrink-0 rounded object-cover" />
          ) : (
            <span className="bg-background flex size-12 shrink-0 items-center justify-center rounded">
              <FileText className="size-5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{arquivo.name}</span>
            <span className="text-muted-foreground text-xs">{formatFileSize(arquivo.size)}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remover arquivo"
            className="size-8 shrink-0"
            disabled={enviando}
            onClick={() => escolher(null)}
          >
            <X />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={WHATSAPP_MEDIA_ACCEPT.join(",")}
          onChange={(event) => {
            selecionar(event.target.files?.[0]);
            // zera para que escolher o mesmo arquivo de novo continue disparando o change
            event.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Anexar arquivo"
          disabled={enviando}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip />
        </Button>
        <Textarea
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Esc desiste da citação sem apagar o que já foi escrito
            if (e.key === "Escape" && replyTo) {
              e.preventDefault();
              onCancelReply?.();
              return;
            }
            // Enter envia, Shift+Enter quebra linha — como em qualquer mensageiro
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder={arquivo ? "Escreva uma legenda (opcional)" : "Escreva uma mensagem"}
          className="max-h-32 min-h-10 flex-1 resize-none"
        />
        <Button
          size="icon"
          aria-label="Enviar mensagem"
          onClick={enviar}
          disabled={(!texto.trim() && !arquivo) || enviando}
        >
          {enviando ? <Spinner /> : <Send />}
        </Button>
      </div>
    </div>
  );
};
