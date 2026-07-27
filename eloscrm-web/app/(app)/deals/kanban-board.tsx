"use client";

import { useState } from "react";
import { Plus, Settings2, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useDeals, useDeleteDeal, useUpdateDeal } from "@/lib/queries/deals";
import { useClients } from "@/lib/queries/clients";
import { formatCurrency } from "@/lib/labels";
import type { Deal, Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DealDialog } from "./deal-dialog";
import { StageManagerDialog } from "./stage-manager-dialog";

export const KanbanBoard = ({ pipeline }: { pipeline: Pipeline }) => {
  const { data: deals, isLoading } = useDeals(pipeline.id);
  const { data: clients } = useClients();
  const move = useUpdateDeal();
  const remove = useDeleteDeal();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);
  const clientNames = new Map((clients ?? []).map((c) => [c.id, c.name] as const));

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

  const handleDelete = async (deal: Deal) => {
    try {
      await remove.mutateAsync(deal.id);
      toast.success("Negócio removido");
    } catch {
      toast.error("Não foi possível remover o negócio");
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
          const stageTotal = stageDeals.reduce((sum, deal) => sum + Number(deal.value ?? 0), 0);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage.id);
              }}
              // relatedTarget dentro da própria coluna = passou por cima de um card filho;
              // sem esse teste o realce pisca a cada card que o cursor cruza
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setOverStage((s) => (s === stage.id ? null : s));
              }}
              onDrop={() => drop(stage.id)}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 transition-shadow",
                overStage === stage.id && "ring-2 ring-primary ring-inset",
              )}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: stage.color ?? "var(--chart-1)" }}
                  />
                  <span className="truncate text-sm font-medium">{stage.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {stageTotal > 0 && (
                    <span className="text-xs text-muted-foreground">{formatCurrency(stageTotal)}</span>
                  )}
                  <span className="rounded bg-background px-1.5 text-xs text-muted-foreground">
                    {stageDeals.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {isLoading && <Skeleton className="h-16 w-full" />}
                {!isLoading && stageDeals.length === 0 && (
                  <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                    Arraste um negócio para cá
                  </div>
                )}
                {stageDeals.map((deal) => {
                  const clientName = clientNames.get(deal.clientId);
                  return (
                    // o botão de excluir fica fora do trigger do DealDialog: aninhar um trigger
                    // dentro do outro faria o clique na lixeira abrir também o dialog de edição
                    <div key={deal.id} className="group/card relative">
                      <DealDialog
                        pipelineId={pipeline.id}
                        stages={stages}
                        deal={deal}
                        nativeButton={false}
                        trigger={
                          <div
                            draggable
                            onDragStart={() => setDragId(deal.id)}
                            onDragEnd={() => setDragId(null)}
                            className={cn(
                              "cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/50 active:cursor-grabbing",
                              dragId === deal.id && "opacity-40",
                            )}
                          >
                            <div className="pr-6 text-sm font-medium">{deal.title}</div>
                            {clientName && (
                              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <User className="size-3 shrink-0" />
                                <span className="truncate">{clientName}</span>
                              </div>
                            )}
                            {/* != null e não truthy: valor 0 é um valor definido, só ausente é undefined */}
                            {deal.value != null && (
                              <div className="mt-1 text-xs font-medium">{formatCurrency(deal.value)}</div>
                            )}
                          </div>
                        }
                      />
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Excluir ${deal.title}`}
                              className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100"
                            >
                              <Trash2 className="size-3.5 text-destructive" />
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir negócio</AlertDialogTitle>
                            <AlertDialogDescription>
                              Tem certeza que deseja excluir &quot;{deal.title}&quot;? Essa ação não pode ser
                              desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => handleDelete(deal)}>
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
