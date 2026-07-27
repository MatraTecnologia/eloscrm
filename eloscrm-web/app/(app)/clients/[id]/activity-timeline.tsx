import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Activity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityIcon } from "./activity-visuals";

export const ActivityTimeline = ({
  activities,
  isLoading,
  limit,
  emptyMessage = "Nenhuma atividade registrada.",
}: {
  activities: Activity[];
  isLoading: boolean;
  limit?: number;
  emptyMessage?: string;
}) => {
  const timeOf = (activity: Activity) => new Date(activity.doneAt ?? activity.dueAt ?? activity.createdAt).getTime();
  const sorted = [...activities].sort((a, b) => timeOf(b) - timeOf(a));
  const visible = limit ? sorted.slice(0, limit) : sorted;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: limit ?? 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul>
      {visible.map((activity, i) => {
        const when = activity.doneAt ?? activity.dueAt ?? activity.createdAt;
        const hasNext = i < visible.length - 1;
        return (
          <li key={activity.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <ActivityIcon type={activity.type} size="sm" />
              {hasNext && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className={cn("flex min-w-0 flex-1 items-center justify-between gap-2", hasNext && "pb-4")}>
              <p className="truncate text-sm font-medium">{activity.description}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {format(parseISO(when), "dd/MM/yyyy '·' HH:mm", { locale: ptBR })}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
