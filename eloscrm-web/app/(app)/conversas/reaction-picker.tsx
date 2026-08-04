"use client";

import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Os seis do WhatsApp. Não há dependência de emoji picker no projeto, e trazer uma para escolher
 * entre meia dúzia de reações seria desproporcional — estes cobrem quase todo uso real.
 *
 * A regra de "nada de emoji na UI" não vale aqui: isto é conteúdo de mensagem, não decoração de
 * interface. O ícone do botão continua sendo SVG.
 */
const RAPIDOS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export const ReactionPicker = ({
  atual,
  onPick,
}: {
  /** emoji que a imobiliária já usou nesta mensagem, se houver */
  atual: string | null;
  onPick: (emoji: string) => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Reagir"
            // some até o hover, mas continua alcançável por teclado, como o botão de responder.
            // Aberto, fica visível — senão o popover flutua ancorado no nada.
            className={cn(
              "size-7 shrink-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            <SmilePlus className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent className="flex w-auto gap-0.5 p-1">
        {RAPIDOS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            // clicar no que já está selecionado desfaz — a API entende emoji vazio como remover
            onClick={() => {
              onPick(emoji === atual ? "" : emoji);
              setOpen(false);
            }}
            aria-label={emoji === atual ? `Remover reação ${emoji}` : `Reagir com ${emoji}`}
            aria-pressed={emoji === atual}
            className={cn(
              "hover:bg-muted rounded-md p-1.5 text-lg leading-none transition-colors",
              emoji === atual && "bg-muted ring-primary ring-2",
            )}
          >
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
