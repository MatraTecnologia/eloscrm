import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_COLORS } from "./chart-colors";

export const SourceDonutCard = ({
  data,
  isLoading,
}: {
  data: { source: string; label: string; total: number }[];
  isLoading: boolean;
}) => {
  const total = data.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clientes por origem</CardTitle>
        {!isLoading && total > 0 && <CardDescription>{total} clientes no total</CardDescription>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="size-40 rounded-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : total === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum cliente cadastrado ainda.</p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Tooltip contentStyle={{ borderRadius: "var(--radius)", fontSize: 12 }} />
                <Pie
                  data={data}
                  dataKey="total"
                  nameKey="label"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={3}
                  cornerRadius={4}
                  strokeWidth={0}
                >
                  {data.map((entry, i) => (
                    <Cell key={entry.source} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="w-full space-y-2">
              {data.map((entry, i) => (
                <div key={entry.source} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="truncate">{entry.label}</span>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {entry.total} · {Math.round((entry.total / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
