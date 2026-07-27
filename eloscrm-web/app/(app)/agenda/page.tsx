"use client";

import { useState } from "react";
import { endOfDay, endOfMonth, format, parse, parseISO, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAgenda } from "@/lib/queries/agenda";
import { useActiveOrganization } from "@/lib/auth-client";
import { activityTypeLabels } from "@/lib/labels";
import type { Activity } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const DATE_FORMAT = "yyyy-MM-dd";

const groupByDay = (activities: Activity[]) =>
  activities.reduce<Record<string, Activity[]>>((acc, activity) => {
    if (!activity.dueAt) return acc;
    const day = format(parseISO(activity.dueAt), DATE_FORMAT);
    acc[day] = acc[day] ?? [];
    acc[day].push(activity);
    return acc;
  }, {});

export default function AgendaPage() {
  const [from, setFrom] = useState(() => format(startOfMonth(new Date()), DATE_FORMAT));
  const [to, setTo] = useState(() => format(endOfMonth(new Date()), DATE_FORMAT));

  const { data: activities, isLoading } = useAgenda({
    from: startOfDay(parse(from, DATE_FORMAT, new Date())).toISOString(),
    to: endOfDay(parse(to, DATE_FORMAT, new Date())).toISOString(),
  });
  const { data: org, isPending: loadingOrg } = useActiveOrganization();

  const groups = Object.entries(groupByDay(activities ?? []));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-muted-foreground">Compromissos e tarefas do período.</p>
      </div>

      <div className="flex items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="from">De</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">Até</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="space-y-6">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-12 w-full" />
            </div>
          ))}

        {!loadingOrg && !org && (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            Selecione ou crie uma imobiliária para ver a agenda.
          </div>
        )}

        {!!org && !isLoading && groups.length === 0 && (
          <p className="py-10 text-center text-muted-foreground">Nenhuma atividade no período.</p>
        )}

        {!isLoading &&
          groups.map(([day, dayActivities]) => (
            <div key={day} className="space-y-2">
              <h2 className="font-medium capitalize">
                {format(parseISO(day), "dd 'de' MMMM", { locale: ptBR })}
              </h2>
              <div className="rounded-lg border divide-y">
                {dayActivities.map((activity) => (
                  <div key={activity.id} className="flex items-center gap-3 p-3">
                    <span className="w-12 shrink-0 text-sm text-muted-foreground">
                      {format(parseISO(activity.dueAt!), "HH:mm")}
                    </span>
                    <Badge variant="secondary">{activityTypeLabels[activity.type]}</Badge>
                    <span className="text-sm">{activity.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
