"use client";

import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useDeals, useUpdateDeal } from "@/lib/queries/deals";
import { dealStageLabels, dealStageOrder, formatCurrency } from "@/lib/labels";
import type { Deal, DealStage } from "@/lib/types";
import { DealDialog } from "./deal-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DealsPage() {
  const { data: deals, isLoading } = useDeals();
  const update = useUpdateDeal();

  const handleDrop = (stage: DealStage) => (e: React.DragEvent<HTMLDivElement>) => {
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    update.mutate(
      { id, input: { stage } },
      { onError: () => toast.error("Não foi possível mover o negócio") },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Negociações</h1>
          <p className="text-muted-foreground">Funil de negócios da imobiliária.</p>
        </div>
        <DealDialog
          trigger={
            <Button>
              <Plus className="size-4" /> Novo negócio
            </Button>
          }
        />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {dealStageOrder.map((stage) => {
          const stageDeals = deals?.filter((deal) => deal.stage === stage) ?? [];
          return (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop(stage)}
              className="flex w-72 shrink-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3"
            >
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-medium">{dealStageLabels[stage]}</h2>
                <span className="text-xs text-muted-foreground">{stageDeals.length}</span>
              </div>

              {isLoading &&
                Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}

              {!isLoading && stageDeals.length === 0 && (
                <p className="px-1 text-xs text-muted-foreground">Nenhum negócio nesta etapa.</p>
              )}

              {stageDeals.map((deal) => (
                <DealCard key={deal.id} deal={deal} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DealCard = ({ deal }: { deal: Deal }) => {
  return (
    <DealDialog
      deal={deal}
      trigger={
        <Card
          size="sm"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
          className="cursor-grab active:cursor-grabbing"
        >
          <CardContent>
            <p className="text-sm font-medium">{deal.title}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(deal.value)}</p>
          </CardContent>
        </Card>
      }
    />
  );
};
