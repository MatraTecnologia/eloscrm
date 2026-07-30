"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History } from "lucide-react";
import { useAuditEvents } from "@/lib/queries/audit";
import { AUDIT_ACTION_LABELS, ENTITY_NOUNS, FIELD_LABELS, formatAuditValue } from "@/lib/labels";
import type { AuditEntity } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useEntityNames } from "./use-entity-names";

export const AuditFeed = ({ entityType, entityId }: { entityType: AuditEntity; entityId: string }) => {
  const { data: events, isLoading } = useAuditEvents(entityType, entityId);
  const resolveName = useEntityNames();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!events?.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>Sem histórico</EmptyTitle>
          <EmptyDescription>
            As alterações feitas neste {ENTITY_NOUNS[entityType]} vão aparecer aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 border-b pb-3 last:border-0">
          <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <History className="size-4" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm">
              <span className="font-medium">{event.actorName ?? "Alguém"}</span>{" "}
              {AUDIT_ACTION_LABELS[event.action]}
            </p>
            {event.changes ? (
              <ul className="space-y-0.5">
                {Object.entries(event.changes).map(([field, change]) => (
                  <li key={field} className="text-xs text-muted-foreground">
                    {FIELD_LABELS[field] ?? field}: {formatAuditValue(field, change.from, resolveName)} →{" "}
                    {formatAuditValue(field, change.to, resolveName)}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {format(parseISO(event.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
};
