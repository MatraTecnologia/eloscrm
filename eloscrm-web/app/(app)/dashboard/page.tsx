"use client";

import { CircleCheck, Handshake, Users, Wallet } from "lucide-react";
import { useDashboardStats } from "@/lib/queries/dashboard";
import { clientSourceLabels, formatCurrency } from "@/lib/labels";
import { StatCard } from "./stat-card";
import { FunnelCard } from "./funnel-card";
import { SourceDonutCard } from "./source-donut-card";
import { RecentActivitiesCard } from "./recent-activities-card";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const loading = statsLoading || !stats;

  const sourceData = (Object.keys(clientSourceLabels) as Array<keyof typeof clientSourceLabels>).map(
    (source) => ({
      source,
      label: clientSourceLabels[source],
      total: stats?.bySource[source] ?? 0,
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral de clientes e negociações.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Clientes"
          value={stats?.kpis.totalClients}
          icon={Users}
          color="var(--chart-1)"
          isLoading={loading}
        />
        <StatCard
          label="Negócios em aberto"
          value={stats?.kpis.openDeals}
          icon={Handshake}
          color="var(--chart-4)"
          isLoading={loading}
        />
        <StatCard
          label="Negócios fechados"
          value={stats?.kpis.wonDeals}
          icon={CircleCheck}
          color="var(--chart-3)"
          isLoading={loading}
        />
        <StatCard
          label="Valor em aberto"
          value={stats ? formatCurrency(stats.kpis.openValue) : undefined}
          icon={Wallet}
          color="var(--chart-2)"
          isLoading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <FunnelCard stages={stats?.funnel ?? []} totalDeals={stats?.kpis.totalDeals} isLoading={loading} />
        <SourceDonutCard data={sourceData} isLoading={loading} />
        <RecentActivitiesCard />
      </div>
    </div>
  );
}
