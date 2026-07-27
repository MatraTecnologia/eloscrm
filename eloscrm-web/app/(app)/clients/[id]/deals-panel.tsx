import { formatCurrency } from "@/lib/labels";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnrichedDeal } from "@/lib/queries/deals";

export const DealsPanel = ({
  deals,
  isLoading,
  limit,
  emptyMessage = "Nenhum negócio para este cliente ainda.",
}: {
  deals: EnrichedDeal[];
  isLoading: boolean;
  limit?: number;
  emptyMessage?: string;
}) => {
  const visible = limit ? deals.slice(0, limit) : deals;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: limit ?? 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="divide-y rounded-lg border">
      {visible.map((deal) => (
        <div key={deal.id} className="flex items-center justify-between gap-4 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{deal.title}</p>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full" style={{ background: deal.stageColor ?? "var(--chart-1)" }} />
              {deal.stageName}
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium">{formatCurrency(deal.value)}</span>
        </div>
      ))}
    </div>
  );
};
