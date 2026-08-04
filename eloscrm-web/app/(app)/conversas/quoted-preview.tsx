"use client";

import { whatsappMessageTypeLabels } from "@/lib/labels";
import type { WhatsappQuoted } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Bloco da mensagem citada. É o mesmo componente na bolha e na barra do compositor de propósito:
 * o corretor vê antes de enviar exatamente o que vai aparecer depois na thread.
 *
 * A miniatura sai do `mediaThumb` que já veio no webhook — a citação nunca pede URL assinada, senão
 * uma thread com muitos replies assinaria dezenas de URLs para mostrar quadradinhos de 40px.
 */
export const QuotedPreview = ({
  quoted,
  mine,
  className,
}: {
  quoted: WhatsappQuoted;
  /** dentro de bolha própria as cores invertem, porque o fundo ali é o primary */
  mine?: boolean;
  className?: string;
}) => {
  const thumb = quoted.mediaThumb ? `data:image/jpeg;base64,${quoted.mediaThumb}` : null;
  const autor = quoted.direction === "outbound" ? "Você" : (quoted.senderName ?? "Contato");
  const resumo = quoted.text?.trim() || whatsappMessageTypeLabels[quoted.type];

  return (
    <div
      className={cn(
        "flex items-center gap-2 overflow-hidden rounded-md border-l-2 py-1 pl-2",
        mine ? "border-primary-foreground/60 bg-black/10" : "border-primary bg-background/60",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{autor}</span>
        <span className="block truncate text-xs opacity-70">{resumo}</span>
      </span>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="size-10 shrink-0 rounded object-cover" />
      )}
    </div>
  );
};
