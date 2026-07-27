"use client";

import { useState } from "react";
import { addDays, endOfDay, formatDistanceToNow, parseISO, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAgenda } from "@/lib/queries/agenda";
import { activityTypeLabels } from "@/lib/labels";
import type { Activity } from "@/lib/types";
import { ActivityIcon } from "@/components/app/activity-visuals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const RecentActivitiesCard = () => {
  const [range] = useState(() => ({
    from: startOfDay(subDays(new Date(), 3)).toISOString(),
    to: endOfDay(addDays(new Date(), 14)).toISOString(),
  }));
  const { data: activities, isLoading } = useAgenda(range);

  const upcoming = (activities ?? [])
    .filter((activity): activity is Activity & { dueAt: string } => !!activity.dueAt)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atividades recentes</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma atividade agendada.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {upcoming.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 p-3">
                <ActivityIcon type={activity.type} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{activity.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {activityTypeLabels[activity.type]} ·{" "}
                    {formatDistanceToNow(parseISO(activity.dueAt), { locale: ptBR, addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
