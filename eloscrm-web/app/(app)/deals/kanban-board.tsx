"use client";

import { useRef, useState } from "react";
import { Building2, Plus, Settings2, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useDeals, useDeleteDeal, useUpdateDeal } from "@/lib/queries/deals";
import { useClients } from "@/lib/queries/clients";
import { useMembers } from "@/lib/queries/members";
import { useProperties } from "@/lib/queries/properties";
import { formatCurrency } from "@/lib/labels";
import type { Deal, Pipeline, Stage } from "@/lib/types";
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
import { DealDetailDialog } from "./deal-detail-dialog";
import { DealFormDialog } from "./deal-form-dialog";
import { LostReasonDialog } from "./lost-reason-dialog";
import { MoveDealMenu } from "./move-deal-menu";
import { useKanbanDrag } from "./use-kanban-drag";
import { StageManagerDialog } from "./stage-manager-dialog";

export const KanbanBoard = ({ pipeline }: { pipeline: Pipeline }) => {
  const { data: deals, isLoading } = useDeals(pipeline.id);
  const { data: clients } = useClients({ status: "ALL" });
  const { data: members } = useMembers();
  const { data: properties } = useProperties();
  const move = useUpdateDeal();
  const remove = useDeleteDeal();
  // negócio arrastado para estágio de perda espera aqui até alguém dizer o motivo
  const [pendingLoss, setPendingLoss] = useState<{ deal: Deal; stage: Stage } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);
  const clientNames = new Map((clients ?? []).map((c) => [c.id, c.name] as const));
  const memberNames = new Map((members ?? []).map((m) => [m.userId, m.name] as const));
  const propertyTitles = new Map((properties ?? []).map((p) => [p.id, p.title] as const));

  const moveDeal = async (id: string, input: { stageId: string; lostReason?: string | null }) => {
    try {
      await move.mutateAsync({ id, input });
    } catch {
      toast.error("Não foi possível mover o negócio");
    }
  };

  /** Destino escolhido — por arraste ou pelo menu "Mover para". A regra é a mesma nos dois. */
  const enviarPara = async (id: string, stageId: string) => {
    const deal = deals?.find((d) => d.id === id);
    if (!deal || deal.stageId === stageId) return;

    const target = stages.find((stage) => stage.id === stageId);
    const from = stages.find((stage) => stage.id === deal.stageId);
    if (target?.isLost) {
      setPendingLoss({ deal, stage: target });
      return;
    }
    // saiu da perda: o motivo antigo deixaria o negócio reaberto carregando um "perdido porque…"
    // que não vale mais. O texto continua no histórico.
    const reopened = from?.isLost && deal.lostReason ? { lostReason: null } : {};
    await moveDeal(id, { stageId, ...reopened });
  };

  const { dragId, overStage, ghost, cardProps } = useKanbanDrag({ onDrop: enviarPara, scrollRef });
  const ghostDeal = ghost ? deals?.find((d) => d.id === ghost.dealId) : null;

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
          <DealFormDialog
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

      <div ref={scrollRef} className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const stageDeals = deals?.filter((d) => d.stageId === stage.id) ?? [];
          const stageTotal = stageDeals.reduce((sum, deal) => sum + Number(deal.value ?? 0), 0);
          return (
            <div
              key={stage.id}
              // o hit-test do arraste acha a coluna por este atributo, com elementFromPoint —
              // não há mais onDragOver/onDrop, que só existiam para mouse
              data-stage-id={stage.id}
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
                    Nenhum negócio neste estágio
                  </div>
                )}
                {stageDeals.map((deal) => {
                  const clientName = clientNames.get(deal.clientId);
                  const ownerName = deal.ownerId ? memberNames.get(deal.ownerId) : null;
                  const propertyTitle = deal.propertyId ? propertyTitles.get(deal.propertyId) : null;
                  return (
                    // o botão de excluir fica fora do trigger do DealDetailDialog: aninhar um trigger
                    // dentro do outro faria o clique na lixeira abrir também o modal do negócio
                    <div key={deal.id} className="group/card relative">
                      <DealDetailDialog
                        pipelineId={pipeline.id}
                        stages={stages}
                        deal={deal}
                        nativeButton={false}
                        trigger={
                          <div
                            {...cardProps(deal.id)}
                            // `pan-y` deixa a coluna rolar com o dedo começando no cartão e ainda
                            // assim entrega o movimento do arraste; `none` mataria a rolagem, que
                            // é a maior parte do uso
                            style={{ touchAction: "pan-y" }}
                            className={cn(
                              "cursor-grab touch-pan-y rounded-lg border bg-card p-3 shadow-sm transition-colors select-none hover:border-primary/50 active:cursor-grabbing",
                              dragId === deal.id && "opacity-30",
                            )}
                          >
                            <div className="pr-14 text-sm font-medium">{deal.title}</div>
                            {clientName && (
                              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <User className="size-3 shrink-0" />
                                <span className="truncate">{clientName}</span>
                              </div>
                            )}
                            {propertyTitle && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <Building2 className="size-3 shrink-0" />
                                <span className="truncate">{propertyTitle}</span>
                              </div>
                            )}
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              {/* != null e não truthy: valor 0 é um valor definido, só ausente é undefined */}
                              <span className="text-xs font-medium">
                                {deal.value != null ? formatCurrency(deal.value) : ""}
                              </span>
                              {ownerName && (
                                // só as iniciais: o nome inteiro empurraria o valor para fora do card
                                <span
                                  title={ownerName}
                                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
                                >
                                  {ownerName
                                    .split(" ")
                                    .slice(0, 2)
                                    .map((part) => part[0])
                                    .join("")
                                    .toUpperCase()}
                                </span>
                              )}
                            </div>
                            {stage.isLost && deal.lostReason && (
                              <p className="mt-1.5 line-clamp-2 border-t pt-1.5 text-xs text-muted-foreground">
                                {deal.lostReason}
                              </p>
                            )}
                          </div>
                        }
                      />
                      <MoveDealMenu
                        deal={deal}
                        stages={stages}
                        onMove={(stageId) => enviarPara(deal.id, stageId)}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Excluir ${deal.title}`}
                              className="absolute top-1.5 right-1.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100"
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

      {ghost && ghostDeal && (
        // fora do fluxo e sem capturar ponteiro: `elementFromPoint` precisa enxergar a coluna por
        // baixo, senão o alvo do arraste seria sempre o próprio fantasma
        <div
          className="pointer-events-none fixed z-50 w-64 -translate-x-1/2 -translate-y-1/2 rotate-2 rounded-lg border bg-card p-3 shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <div className="text-sm font-medium">{ghostDeal.title}</div>
          {ghostDeal.value != null && (
            <div className="mt-1 text-xs font-medium">{formatCurrency(ghostDeal.value)}</div>
          )}
        </div>
      )}

      {pendingLoss && (
        <LostReasonDialog
          open
          dealTitle={pendingLoss.deal.title}
          stageName={pendingLoss.stage.name}
          saving={move.isPending}
          onCancel={() => setPendingLoss(null)}
          onConfirm={async (reason) => {
            const { deal, stage } = pendingLoss;
            setPendingLoss(null);
            await moveDeal(deal.id, { stageId: stage.id, lostReason: reason });
          }}
        />
      )}
    </div>
  );
};
