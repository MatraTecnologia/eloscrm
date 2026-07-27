"use client";

import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useDeals, useUpdateDeal } from "@/lib/queries/deals";
import { formatCurrency } from "@/lib/labels";
import type { Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DealDialog } from "./deal-dialog";
import { StageManagerDialog } from "./stage-manager-dialog";

export const KanbanBoard = ({ pipeline }: { pipeline: Pipeline }) => {
  const { data: deals, isLoading } = useDeals(pipeline.id);
  const move = useUpdateDeal();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);

  const drop = async (stageId: string) => {
    setOverStage(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const deal = deals?.find((d) => d.id === id);
    if (!deal || deal.stageId === stageId) return;
    try {
      await move.mutateAsync({ id, input: { stageId } });
    } catch {
      toast.error("Não foi possível mover o negócio");
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{pipeline.name}</h2>
        <div className="flex gap-2">
          <StageManagerDialog
            pipeline={pipeline}
            trigger={
              <Button variant="outline">
                <Settings2 className="size-4" /> Gerenciar estágios
              </Button>
            }
          />
          <DealDialog
            pipelineId={pipeline.id}
            stages={stages}
            trigger={
              <Button>
                <Plus className="size-4" /> Novo negócio
              </Button>
            }
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageDeals = deals?.filter((d) => d.stageId === stage.id) ?? [];
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage.id);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => drop(stage.id)}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 transition-shadow",
                overStage === stage.id && "ring-2 ring-primary ring-inset",
              )}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: stage.color ?? "var(--chart-1)" }}
                  />
                  <span className="text-sm font-medium">{stage.name}</span>
                </div>
                <span className="rounded bg-background px-1.5 text-xs text-muted-foreground">
                  {stageDeals.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {isLoading && <Skeleton className="h-16 w-full" />}
                {stageDeals.map((deal) => (
                  <DealDialog
                    key={deal.id}
                    pipelineId={pipeline.id}
                    stages={stages}
                    deal={deal}
                    nativeButton={false}
                    trigger={
                      <div
                        draggable
                        onDragStart={() => setDragId(deal.id)}
                        onDragEnd={() => setDragId(null)}
                        className="cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 active:cursor-grabbing"
                      >
                        <div className="text-sm font-medium">{deal.title}</div>
                        {deal.value && (
                          <div className="mt-1 text-xs text-muted-foreground">{formatCurrency(deal.value)}</div>
                        )}
                      </div>
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
