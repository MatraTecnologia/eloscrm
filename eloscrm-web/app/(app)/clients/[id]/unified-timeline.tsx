"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, History, MessageSquare } from "lucide-react";
import { useClientTimeline } from "@/lib/queries/timeline";
import { AUDIT_ACTION_LABELS, FIELD_LABELS, activityTypeLabels, formatFileSize } from "@/lib/labels";
import type { TimelineItem } from "@/lib/types";
import { ActivityIcon } from "@/components/app/activity-visuals";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const showValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
};

const Line = ({ item }: { item: TimelineItem }) => {
  if (item.kind === "ACTIVITY") {
    return (
      <>
        <ActivityIcon type={item.payload.type} size="md" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            <span className="font-medium">{activityTypeLabels[item.payload.type]}</span>{" "}
            {item.payload.description}
          </p>
        </div>
      </>
    );
  }

  if (item.kind === "COMMENT") {
    return (
      <>
        <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MessageSquare className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            <span className="font-medium">{item.payload.authorName}</span> comentou
          </p>
          <p className="text-sm whitespace-pre-line text-muted-foreground">{item.payload.body}</p>
        </div>
      </>
    );
  }

  if (item.kind === "ATTACHMENT") {
    return (
      <>
        <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm">
            <span className="font-medium">{item.payload.uploadedByName}</span> anexou{" "}
            {item.payload.filename}
          </p>
          <p className="text-xs text-muted-foreground">{formatFileSize(item.payload.size)}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <History className="size-4" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm">
          <span className="font-medium">{item.payload.actorName ?? "Alguém"}</span>{" "}
          {AUDIT_ACTION_LABELS[item.payload.action]}
        </p>
        {item.payload.changes ? (
          <ul className="space-y-0.5">
            {Object.entries(item.payload.changes).map(([field, change]) => (
              <li key={field} className="text-xs text-muted-foreground">
                {FIELD_LABELS[field] ?? field}: {showValue(change.from)} → {showValue(change.to)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
};

export const UnifiedTimeline = ({ clientId }: { clientId: string }) => {
  const { data: items, isLoading } = useClientTimeline(clientId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!items?.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>Nada por aqui ainda</EmptyTitle>
          <EmptyDescription>
            Atividades, alterações, comentários e arquivos deste lead aparecem juntos aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="flex gap-3 border-b pb-3 last:border-0">
          <Line item={item} />
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {format(parseISO(item.at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          </span>
        </li>
      ))}
    </ol>
  );
};
