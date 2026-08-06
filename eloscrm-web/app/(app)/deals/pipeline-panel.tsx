"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import type { Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeletePipelineDialog } from "./delete-pipeline-dialog";
import { PipelineFormDialog } from "./pipeline-form-dialog";

export const PipelinePanel = ({
  pipelines,
  activeId,
  onSelect,
  dropTargetId,
}: {
  pipelines: Pipeline[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  /** funil sob o cartão que está sendo arrastado no quadro ao lado */
  dropTargetId?: string | null;
}) => {
  // o diálogo carrega a prévia e decide o que dizer: excluir um funil apaga os estágios, e com
  // negócio dentro o servidor recusa — cada caso pede uma explicação diferente
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);
  const [renameTarget, setRenameTarget] = useState<Pipeline | null>(null);


  return (
    // Coluna ao lado do funil no desktop; em tela estreita, uma faixa rolável no topo — 240px fixos
    // tomavam mais da metade de um celular e deixavam o kanban espremido num vão de 150px.
    <aside className="flex w-full shrink-0 items-center gap-2 rounded-xl border bg-card p-2 md:w-60 md:flex-col md:items-stretch md:p-3">
      {/* `contents` desmancha esta linha no celular: o botão de novo funil passa a ser filho direto
          da faixa, sem o título ocupar uma segunda linha só para ele */}
      <div className="contents md:flex md:items-center md:justify-between md:px-1 md:pb-2">
        <span className="hidden text-sm font-semibold md:inline">Pipelines</span>
        <PipelineFormDialog
          onCreated={onSelect}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              // `order-last` porque, com o `contents` acima, o botão vira irmão da faixa e nasceria
              // antes dela — criar funil é a ação menos frequente, fica no fim
              className="order-last size-8 shrink-0 md:order-none md:size-7"
              title="Novo pipeline"
            >
              <Plus className="size-4" />
            </Button>
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:w-full md:flex-col md:gap-0.5 md:overflow-visible">
        {pipelines.map((p) => (
          <div
            key={p.id}
            // é este atributo que o arraste do kanban procura com `elementFromPoint`; fica no item,
            // nunca no `aside`, senão soltar em qualquer sobra do painel viraria transferência
            data-pipeline-id={p.id}
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-lg md:shrink",
              activeId === p.id && "bg-accent",
              // cartão pairando sobre este funil: cor cheia, e não só um anel — no celular o
              // fantasma passa por cima e um contorno fino se perderia embaixo dele
              dropTargetId === p.id && "bg-primary/15 ring-2 ring-primary ring-inset",
            )}
          >
            <button
              onClick={() => onSelect(p.id)}
              className={cn(
                "flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm",
                activeId === p.id
                  ? "font-medium text-accent-foreground"
                  : "text-foreground hover:bg-muted/50",
              )}
            >
              {p.name}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    // sempre visível no toque: sem mouse não há hover, e o menu do funil
                    // (renomear, excluir) ficaria inalcançável
                    className="size-7 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:data-[popup-open]:opacity-100"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTimeout(() => setRenameTarget(p), 0)}>
                  <Pencil className="size-4" /> Renomear
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeleteTarget(p)}>
                  <Trash2 className="size-4" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <DeletePipelineDialog
          pipeline={deleteTarget}
          open
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        />
      )}

      {renameTarget && (
        <PipelineFormDialog
          pipeline={renameTarget}
          open
          onOpenChange={(o) => !o && setRenameTarget(null)}
        />
      )}
    </aside>
  );
};
