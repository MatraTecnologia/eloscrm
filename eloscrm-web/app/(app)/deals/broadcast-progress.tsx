"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useBroadcast, useCancelBroadcast } from "@/lib/queries/broadcasts";
import type { Broadcast, BroadcastRecipientStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<Broadcast["status"], string> = {
  RUNNING: "Enviando",
  DONE: "Concluído",
  CANCELED: "Cancelado",
};

const RECIPIENT: Record<
  BroadcastRecipientStatus,
  { label: string; icon: typeof Clock; className: string }
> = {
  PENDING: { label: "Na fila", icon: Clock, className: "text-muted-foreground" },
  SENT: { label: "Enviada", icon: CheckCircle2, className: "text-success" },
  FAILED: { label: "Falhou", icon: XCircle, className: "text-destructive" },
  SKIPPED: { label: "Pulada", icon: Ban, className: "text-muted-foreground" },
};

export const BroadcastStatusBadge = ({ status }: { status: Broadcast["status"] }) => (
  <Badge
    variant="outline"
    className={cn(
      status === "RUNNING" && "border-primary/40 text-primary",
      status === "DONE" && "border-success/40 text-success",
      status === "CANCELED" && "text-muted-foreground",
    )}
  >
    {STATUS_LABEL[status]}
  </Badge>
);

/** Andamento de um disparo: contadores, barra e a lista de destinatários com o que aconteceu. */
export const BroadcastProgress = ({ broadcastId }: { broadcastId: string }) => {
  const { data: broadcast, isLoading } = useBroadcast(broadcastId);
  const cancel = useCancelBroadcast();

  if (isLoading || !broadcast) return <Skeleton className="h-40 w-full" />;

  const feitos = broadcast.sent + broadcast.failed + broadcast.skipped;
  const pct = broadcast.total ? Math.round((feitos / broadcast.total) * 100) : 100;

  const cancelar = async () => {
    try {
      await cancel.mutateAsync(broadcast.id);
      toast.success("Disparo cancelado. O que já foi enviado permanece.");
    } catch {
      toast.error("Não foi possível cancelar");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <BroadcastStatusBadge status={broadcast.status} />
        <span className="text-sm text-muted-foreground">
          {broadcast.pipelineName} ·{" "}
          {format(parseISO(broadcast.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })} · por{" "}
          {broadcast.createdByName}
        </span>
        {broadcast.status === "RUNNING" && (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            disabled={cancel.isPending}
            onClick={cancelar}
          >
            <Ban className="size-3.5" /> Cancelar o restante
          </Button>
        )}
      </div>

      <Progress value={pct} className="gap-1">
        <div className="flex w-full justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {broadcast.sent} enviadas
            {broadcast.failed > 0 && ` · ${broadcast.failed} falharam`}
            {broadcast.skipped > 0 && ` · ${broadcast.skipped} puladas`}
          </span>
          <span>
            {feitos}/{broadcast.total}
          </span>
        </div>
      </Progress>

      <p className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
        {broadcast.text}
      </p>

      <ScrollArea className="-mr-2 min-h-0 flex-1 scroll-fade">
        <div className="space-y-1 pr-3">
          {broadcast.recipients.map((r) => {
            const meta = RECIPIENT[r.status];
            const Icon = meta.icon;
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <Icon className={cn("size-4 shrink-0", meta.className)} />
                <span className="min-w-0 flex-1 truncate">{r.clientName}</span>
                <span className={cn("shrink-0 text-xs", meta.className)} title={r.error ?? undefined}>
                  {r.error ?? meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
