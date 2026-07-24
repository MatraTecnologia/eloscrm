"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardStats } from "@/lib/queries/dashboard";
import { clientSourceLabels, dealStageLabels, dealStageOrder, formatCurrency } from "@/lib/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();

  const funnelData = dealStageOrder.map((stage) => ({
    stage: dealStageLabels[stage],
    total: stats?.funnel[stage] ?? 0,
  }));

  const sourceData = stats
    ? (Object.keys(clientSourceLabels) as Array<keyof typeof clientSourceLabels>).map((source) => ({
        source: clientSourceLabels[source],
        total: stats.bySource[source] ?? 0,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral de clientes e negociações.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Clientes" value={stats?.kpis.totalClients} isLoading={isLoading} />
        <KpiCard title="Negócios em aberto" value={stats?.kpis.openDeals} isLoading={isLoading} />
        <KpiCard title="Negócios fechados" value={stats?.kpis.wonDeals} isLoading={isLoading} />
        <KpiCard
          title="Valor em aberto"
          value={stats ? formatCurrency(stats.kpis.openValue) : undefined}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funil de negócios</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={funnelData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="stage"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="total" name="Negócios" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clientes por origem</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={288}>
                <PieChart>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Pie
                    data={sourceData}
                    dataKey="total"
                    nameKey="source"
                    innerRadius={60}
                    outerRadius={100}
                  >
                    {sourceData.map((entry, index) => (
                      <Cell key={entry.source} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const KpiCard = ({
  title,
  value,
  isLoading,
}: {
  title: string;
  value: string | number | undefined;
  isLoading: boolean;
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-8 w-24" /> : <p className="text-2xl font-semibold">{value}</p>}
      </CardContent>
    </Card>
  );
};
