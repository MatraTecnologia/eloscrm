"use client";

import { useState } from "react";
import Link from "next/link";
import { addDays, endOfDay, formatDistanceToNow, parseISO, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Snowflake } from "lucide-react";
import { useAgenda } from "@/lib/queries/agenda";
import { activityTypeLabels } from "@/lib/labels";
import { ActivityIcon } from "@/components/app/activity-visuals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const RecentActivitiesCard = () => {
  const [range] = useState(() => ({
    from: startOfDay(subDays(new Date(), 3)).toISOString(),
    to: endOfDay(addDays(new Date(), 14)).toISOString(),
  }));
  const { data: items, isLoading } = useAgenda(range);

  const upcoming = (items ?? []).slice().sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Próximos compromissos</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nada agendado.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {upcoming.map((item) =>
              item.kind === "NURTURE" ? (
                <div key={`${item.kind}-${item.id}`} className="flex items-start gap-3 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Snowflake className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/clients/${item.payload.clientId}`} className="block truncate text-sm font-medium hover:underline">
                      {item.payload.clientName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Retomar · {formatDistanceToNow(parseISO(item.at), { locale: ptBR, addSuffix: true })}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={`${item.kind}-${item.id}`} className="flex items-start gap-3 p-3">
                  <ActivityIcon type={item.payload.type} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.payload.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {activityTypeLabels[item.payload.type]} ·{" "}
                      {formatDistanceToNow(parseISO(item.at), { locale: ptBR, addSuffix: true })}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
