"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useBroadcast, useBroadcastAction } from "@/lib/queries/broadcasts";
import { CampaignRecipientReport } from "@/components/whatsapp-official/campaign-recipient-report";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import type { Broadcast, BroadcastRecipientStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<Broadcast["status"], string> = {
  RUNNING: "Enviando",
  PAUSED: "Pausado",
  DONE: "Concluído",
  CANCELED: "Cancelado",
};

const RECIPIENT: Record<
  BroadcastRecipientStatus,
  { label: string; icon: typeof Clock; className: string }
> = {
  PENDING: { label: "Na fila", icon: Clock, className: "text-muted-foreground" },
  PROCESSING: { label: "Processando", icon: Clock, className: "text-muted-foreground" },
  UNKNOWN: { label: "Resultado incerto", icon: XCircle, className: "text-destructive" },
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
  const query = useBroadcast(broadcastId);
  const { data: broadcast, isLoading } = query;
  const action = useBroadcastAction();
  const [confirming, setConfirming] = useState(false);

  if (query.isError) return <p role="alert">Não foi possível carregar o disparo. <Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></p>;
  if (isLoading || !broadcast) return <Skeleton className="h-40 w-full" />;

  const completed = broadcast.sent + broadcast.failed + broadcast.skipped + broadcast.uncertain;
  const percentage = broadcast.total ? Math.round((completed / broadcast.total) * 100) : 100;

  const run = async (next: "pause" | "resume" | "cancel") => {
    try {
      await action.mutateAsync({ id: broadcast.id, action: next });
      setConfirming(false);
      toast.success(next === "pause" ? "Disparo pausado" : next === "resume" ? "Disparo retomado" : "Disparo encerrado. O que já foi enviado permanece.");
    } catch (error) {
      toast.error((error as { message?: string }).message ?? "Não foi possível atualizar o disparo");
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
        {["RUNNING", "PAUSED"].includes(broadcast.status) && <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => run(broadcast.status === "PAUSED" ? "resume" : "pause")}>{broadcast.status === "PAUSED" ? "Continuar" : "Pausar"}</Button>}
        {["RUNNING", "PAUSED"].includes(broadcast.status) && (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            disabled={action.isPending}
            onClick={() => setConfirming(true)}
          >
            <Ban className="size-3.5" /> Cancelar o restante
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">O envio continua no servidor com o app fechado. Pausar impede novas tentativas; a tentativa em andamento pode concluir. Encerrar cancela apenas os destinos restantes.</p>
      <Progress value={percentage} className="gap-1">
        <div className="flex w-full justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {broadcast.sent} enviadas
            {broadcast.failed > 0 && ` · ${broadcast.failed} falharam`}
            {broadcast.skipped > 0 && ` · ${broadcast.skipped} puladas`}
            {broadcast.uncertain > 0 && ` · ${broadcast.uncertain} incertas`}
          </span>
          <span>
            {completed}/{broadcast.total}
          </span>
        </div>
      </Progress>

      <p className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
        {broadcast.text}
      </p>

      <CampaignRecipientReport campaignId={broadcast.id} rows={broadcast.recipients.map(row => ({ id: row.id, name: row.clientName, destination: row.number, status: row.status, label: RECIPIENT[row.status].label, error: row.error, code: row.errorCode, stage: row.errorStage, attempts: row.attempts, startedAt: row.startedAt, completedAt: row.completedAt, text: row.text }))} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Encerrar o disparo?</AlertDialogTitle><AlertDialogDescription>Os destinatários ainda na fila serão cancelados. Mensagens já submetidas poderão concluir; esta campanha não poderá ser retomada depois de encerrada.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={action.isPending}>Voltar</AlertDialogCancel><Button variant="destructive" disabled={action.isPending} onClick={() => run("cancel")}>Encerrar disparo</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
};
