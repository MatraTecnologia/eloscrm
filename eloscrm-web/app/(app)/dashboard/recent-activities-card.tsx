"use client";

import { useState } from "react";
import { addDays, endOfDay, formatDistanceToNow, parseISO, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, MapPin, Phone, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAgenda } from "@/lib/queries/agenda";
import { activityTypeLabels } from "@/lib/labels";
import type { Activity, ActivityType } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TYPE_STYLE: Record<ActivityType, { icon: LucideIcon; color: string }> = {
  CALL: { icon: Phone, color: "var(--chart-1)" },
  VISIT: { icon: MapPin, color: "var(--chart-3)" },
  PROPOSAL: { icon: FileText, color: "var(--chart-4)" },
  NOTE: { icon: StickyNote, color: "var(--chart-5)" },
};

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
            {upcoming.map((activity) => {
              const { icon: Icon, color } = TYPE_STYLE[activity.type];
              return (
                <div key={activity.id} className="flex items-start gap-3 p-3">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{activity.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {activityTypeLabels[activity.type]} ·{" "}
                      {formatDistanceToNow(parseISO(activity.dueAt), { locale: ptBR, addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
