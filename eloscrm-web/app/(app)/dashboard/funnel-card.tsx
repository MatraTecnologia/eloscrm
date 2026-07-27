import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS } from "./chart-colors";

export const FunnelCard = ({
  stages,
  totalDeals,
  isLoading,
}: {
  stages: { name: string; total: number }[];
  totalDeals: number | undefined;
  isLoading: boolean;
}) => {
  const maxTotal = Math.max(1, ...stages.map((stage) => stage.total));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de negócios</CardTitle>
        {!isLoading && totalDeals != null && (
          <CardDescription>{totalDeals} negócios no total</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : stages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum negócio cadastrado ainda.</p>
        ) : (
          <div className="space-y-4">
            {stages.map((stage, i) => (
              <div key={stage.name} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{stage.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{stage.total}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(stage.total / maxTotal) * 100}%`,
                      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
