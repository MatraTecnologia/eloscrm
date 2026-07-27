"use client";

import { useState } from "react";
import Link from "next/link";
import { endOfDay, endOfMonth, format, parse, parseISO, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAgenda } from "@/lib/queries/agenda";
import { useDeleteActivity, useUpdateActivity } from "@/lib/queries/activities";
import { useActiveOrganization } from "@/lib/auth-client";
import { activityTypeLabels } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/types";
import { ActivityIcon } from "@/components/app/activity-visuals";
import { ActivityDialog } from "@/components/app/activity-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  const update = useUpdateActivity();
  const remove = useDeleteActivity();
  const hasOrg = !!org;

  // "agora" congelado na montagem: chamar Date.now() no render torna o atraso instável entre renders
  const [now] = useState(() => Date.now());

  const groups = Object.entries(groupByDay(activities ?? []));

  const toggleDone = async (activity: Activity) => {
    try {
      // null (e não undefined) para desmarcar: undefined some da serialização e o PATCH viraria no-op
      await update.mutateAsync({
        id: activity.id,
        input: { doneAt: activity.doneAt ? null : new Date().toISOString() },
      });
    } catch {
      toast.error("Não foi possível atualizar a atividade");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast.success("Atividade removida");
    } catch {
      toast.error("Não foi possível remover");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-muted-foreground">Compromissos e tarefas do período.</p>
        </div>
        <ActivityDialog
          trigger={
            <Button disabled={!hasOrg}>
              <Plus className="size-4" /> Nova atividade
            </Button>
          }
        />
      </div>

      {!loadingOrg && !hasOrg && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária para ver a agenda.
        </div>
      )}

      {hasOrg && (
        <>
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

            {!isLoading && groups.length === 0 && (
              <p className="py-10 text-center text-muted-foreground">Nenhuma atividade no período.</p>
            )}

            {!isLoading &&
              groups.map(([day, dayActivities]) => (
                <div key={day} className="space-y-2">
                  {/* first-letter e não capitalize: "24 de julho" não vira "24 De Julho" */}
                  <h2 className="font-medium first-letter:uppercase">
                    {format(parseISO(day), "dd 'de' MMMM", { locale: ptBR })}
                  </h2>
                  <div className="rounded-lg border divide-y">
                    {dayActivities.map((activity) => {
                      const done = !!activity.doneAt;
                      const overdue = !done && new Date(activity.dueAt!).getTime() < now;
                      return (
                        <div key={activity.id} className="group flex items-center gap-3 p-3">
                          <Checkbox
                            checked={done}
                            onCheckedChange={() => toggleDone(activity)}
                            aria-label={done ? "Reabrir atividade" : "Concluir atividade"}
                          />
                          <span className="w-12 shrink-0 text-sm text-muted-foreground">
                            {format(parseISO(activity.dueAt!), "HH:mm")}
                          </span>
                          <ActivityIcon type={activity.type} size="sm" />
                          <Badge variant="secondary">{activityTypeLabels[activity.type]}</Badge>
                          <span className={cn("min-w-0 truncate text-sm", done && "text-muted-foreground line-through")}>
                            {activity.description}
                          </span>
                          {activity.client && (
                            <Link
                              href={`/clients/${activity.client.id}`}
                              className="shrink-0 text-sm text-muted-foreground hover:underline"
                            >
                              {activity.client.name}
                            </Link>
                          )}
                          {overdue && (
                            <Badge variant="outline" className="shrink-0 border-destructive/20 bg-destructive/10 text-destructive">
                              Atrasada
                            </Badge>
                          )}
                          <div className="ml-auto flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                            <ActivityDialog
                              activity={activity}
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label="Editar atividade">
                                  <Pencil className="size-4" />
                                </Button>
                              }
                            />
                            <AlertDialog>
                              <AlertDialogTrigger
                                render={
                                  <Button variant="ghost" size="icon-sm" aria-label="Excluir atividade">
                                    <Trash2 className="size-4 text-destructive" />
                                  </Button>
                                }
                              />
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir atividade</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Tem certeza que deseja excluir &quot;{activity.description}&quot;? Essa ação
                                    não pode ser desfeita.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction variant="destructive" onClick={() => handleDelete(activity.id)}>
                                    Excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
