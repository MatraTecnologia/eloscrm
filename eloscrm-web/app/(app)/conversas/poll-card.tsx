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
 * Os votos chegam em evento próprio (`PollUpdateMessage`) e a ingestão os aplica **nesta** mensagem,
 * como faz com a reação. Enquanto ninguém votou, o cartão não inventa "0 votos": mostra só as
 * opções. Votar continua sendo no celular — a uazapi não expõe endpoint para isso.
 */
export const PollCard = ({ poll, mine }: { poll: SharedPoll; mine: boolean }) => {
  const votos = poll.votes ?? [];

  return (
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
      {poll.options.map((opcao, indice) => {
        // múltipla escolha: o mesmo voto marca várias opções, então ele conta em cada uma delas
        const desta = votos.filter((voto) => voto.choices.includes(opcao));
        const escolhida = desta.length > 0;

        return (
          <li
            key={`${opcao}-${indice}`}
            className={cn(
              "border-current/15 flex items-center gap-2 rounded border px-2 py-1.5 text-xs",
              escolhida && "border-current/40 bg-current/5",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-3 shrink-0 items-center justify-center border",
                escolhida ? "border-current bg-current/70" : "border-current/40",
                poll.multiple ? "rounded-[3px]" : "rounded-full",
              )}
            />
            <span className="min-w-0 flex-1 break-words">{opcao}</span>
            {escolhida && (
              // quem votou importa mais que quantos: a conversa é com uma pessoa só, e na de grupo
              // o nome é o que diz de quem foi
              <span
                className="shrink-0 text-[11px] opacity-70"
                title={desta.map((voto) => voto.voterName ?? "Alguém").join(", ")}
              >
                {desta.length === 1
                  ? (desta[0]!.voterName ?? "Votou")
                  : `${desta.length} votos`}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  </div>
  );
};
