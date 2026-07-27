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
    <aside className="flex w-60 shrink-0 flex-col rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-sm font-semibold">Pipelines</span>
        <PipelineFormDialog
          onCreated={onSelect}
          trigger={
            <Button variant="ghost" size="icon" className="size-7" title="Novo pipeline">
              <Plus className="size-4" />
            </Button>
          }
        />
      </div>
      <div className="flex flex-col gap-0.5">
        {pipelines.map((p) => (
          <div
            key={p.id}
            className={cn("group flex items-center gap-1 rounded-lg", activeId === p.id && "bg-accent")}
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
                    className="size-7 opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100"
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
