"use client";

import { useState } from "react";
import Link from "next/link";
import { Send, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSendMessage } from "@/lib/queries/conversations";
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
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const send = useSendMessage();

  const enviar = () => {
    const valor = texto.trim();
    if (!valor || send.isPending) return;

    send.mutate(
      { conversationId, text: valor, replyToId: replyTo?.id },
      {
        // limpa só no sucesso: se falhar, o texto continua no campo para reenviar
        onSuccess: () => {
          setTexto("");
          setBloqueio(null);
          onCancelReply?.();
        },
        onError: (err) => {
          // o interceptor do axios rejeita já com o envelope { code, message } da API, não com Error
          const erro = err as unknown as ApiError;
          // limite do próprio WhatsApp não é falha da conexão — merece explicação, não um toast
          if (erro.code === "WHATSAPP_BLOCKED") {
            setBloqueio(erro.message);
            return;
          }
          toast.error(erro.message ?? "Não foi possível enviar");
        },
      },
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

      <div className="flex items-end gap-2">
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
          placeholder="Escreva uma mensagem"
          className="max-h-32 min-h-10 flex-1 resize-none"
        />
        <Button
          size="icon"
          aria-label="Enviar mensagem"
          onClick={enviar}
          disabled={!texto.trim() || send.isPending}
        >
          <Send />
        </Button>
      </div>
    </div>
  );
};
