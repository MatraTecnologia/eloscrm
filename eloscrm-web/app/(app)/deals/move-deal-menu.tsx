"use client";

import { Check, MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Deal, Stage } from "@/lib/types";

/**
 * Mover sem arrastar.
 *
 * Existe por três motivos, e nenhum deles é redundância: é o único caminho operável por **teclado**
 * (o kanban não tinha nenhum), é mais rápido que arrastar quando o destino está quatro colunas
 * adiante, e é a saída quando o gesto de arrastar não se comporta no aparelho.
 */
export const MoveDealMenu = ({
  deal,
  stages,
  onMove,
}: {
  deal: Deal;
  stages: Stage[];
  onMove: (stageId: string) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Mover ${deal.title} de estágio`}
          // quem posiciona é a faixa de controles do cartão; aqui fica só a regra de aparecer.
          // `@media(hover:hover)` e não `md:`: breakpoint mede largura, não se o aparelho tem
          // mouse — um tablet grande passa de 768px, é touch, e o botão sumiria
          className="opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/card:opacity-100 [@media(hover:hover)]:group-hover/card:opacity-100"
        />
      }
    >
      <MoveRight className="size-3.5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {/* o Group não é decoração: o Base UI exige que o Label viva dentro de um, e sem ele o menu
          estoura em runtime — o build não acusa */}
      <DropdownMenuGroup>
        <DropdownMenuLabel>Mover para</DropdownMenuLabel>
        {stages.map((stage) => (
          <DropdownMenuItem
            key={stage.id}
            disabled={stage.id === deal.stageId}
            onClick={() => onMove(stage.id)}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: stage.color ?? "var(--chart-1)" }}
            />
            {stage.name}
            {stage.id === deal.stageId && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
