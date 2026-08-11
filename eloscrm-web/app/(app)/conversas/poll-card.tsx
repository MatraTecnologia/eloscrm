"use client";

import { ChartColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SharedPoll } from "@/lib/types";

/**
 * Enquete.
 *
 * A bolha mostrava só a pergunta — as opções vinham no envelope e se perdiam. Aqui elas aparecem na
 * ordem em que foram criadas, com a marca de seleção que o WhatsApp usa: círculo para escolher uma,
 * quadrado para marcar várias.
 *
 * **Sem contagem de votos, e isso é honesto.** O voto chega em evento separado, que a ingestão não
 * consome; mostrar "0 votos" ao lado de cada opção afirmaria algo que não sabemos. O corretor
 * responde a enquete no celular, onde ela é interativa de verdade.
 */
export const PollCard = ({ poll, mine }: { poll: SharedPoll; mine: boolean }) => (
  <div
    className={cn(
      "flex w-64 flex-col gap-2 rounded-md p-2 sm:w-72",
      mine ? "bg-primary-foreground/15" : "bg-background/60",
    )}
  >
    <div className="flex items-start gap-2">
      <ChartColumn className="mt-0.5 size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words">{poll.name}</span>
        <span className="text-xs opacity-70">
          {poll.multiple ? "Escolha uma ou mais" : "Escolha uma opção"}
        </span>
      </span>
    </div>

    <ul className="flex flex-col gap-1">
      {poll.options.map((opcao, indice) => (
        <li
          key={`${opcao}-${indice}`}
          className="border-current/15 flex items-center gap-2 rounded border px-2 py-1.5 text-xs"
        >
          <span
            aria-hidden
            className={cn(
              "border-current/40 size-3 shrink-0 border",
              poll.multiple ? "rounded-[3px]" : "rounded-full",
            )}
          />
          <span className="min-w-0 break-words">{opcao}</span>
        </li>
      ))}
    </ul>
  </div>
);
