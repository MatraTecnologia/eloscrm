"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDeletePipeline } from "@/lib/queries/pipelines";
import type { Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PipelineFormDialog } from "./pipeline-form-dialog";

export const PipelinePanel = ({
  pipelines,
  activeId,
  onSelect,
}: {
  pipelines: Pipeline[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) => {
  const del = useDeletePipeline();
  const [renameTarget, setRenameTarget] = useState<Pipeline | null>(null);

  const remove = async (p: Pipeline) => {
    try {
      await del.mutateAsync(p.id);
      toast.success("Pipeline excluído");
    } catch (e) {
      const code = (e as { code?: string })?.code;
      toast.error(
        code === "PIPELINE_HAS_DEALS"
          ? "Mova ou exclua os negócios antes"
          : code === "LAST_PIPELINE"
            ? "Você precisa de ao menos um pipeline"
            : "Não foi possível excluir",
      );
    }
  };

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
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-lg md:shrink",
              activeId === p.id && "bg-accent",
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
                <DropdownMenuItem onClick={() => remove(p)}>
                  <Trash2 className="size-4" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

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
