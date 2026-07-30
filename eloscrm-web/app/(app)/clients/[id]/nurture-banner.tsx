"use client";

import { useState } from "react";
import { Snowflake } from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { nurtureReasonLabels } from "@/lib/labels";
import type { Client } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReactivateDialog } from "@/components/app/reactivate-dialog";
import { ReschedulePopover } from "@/app/(app)/nurturing/reschedule-popover";

export const NurtureBanner = ({ client }: { client: Client }) => {
  // "agora" congelado na montagem, como a agenda e a tela de nutrição já fazem: Date.now() no
  // render é impuro e o lint (react-hooks/purity) recusa
  const [now] = useState(() => Date.now());

  if (client.status !== "NURTURING") return null;

  // mesma regra da tela de nutrição: vencido é `nurtureUntil` no passado
  const overdue = !!client.nurtureUntil && new Date(client.nurtureUntil).getTime() < now;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-muted/40 p-4">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 font-medium">
          <Snowflake className="size-4" />
          Em nutrição
        </div>
        {client.nurtureReason && (
          <p className="text-sm text-muted-foreground">
            {nurtureReasonLabels[client.nurtureReason]}
            {client.nurtureNote && ` — ${client.nurtureNote}`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {client.nurturedAt && (
            <span>Parado há {formatDistanceToNow(parseISO(client.nurturedAt), { locale: ptBR })}</span>
          )}
          <span className="flex items-center gap-2">
            Retomar em{" "}
            {client.nurtureUntil ? format(parseISO(client.nurtureUntil), "dd/MM/yyyy") : "sem data definida"}
            {overdue && (
              <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                Atrasado
              </Badge>
            )}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <ReschedulePopover
          client={client}
          trigger={
            <Button variant="outline" size="sm">
              Reagendar
            </Button>
          }
        />
        <ReactivateDialog
          client={client}
          trigger={<Button size="sm">Retomar contato</Button>}
        />
      </div>
    </div>
  );
};
