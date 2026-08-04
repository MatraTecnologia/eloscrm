"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useReconcileWhatsappWebhook,
  useWhatsappWebhook,
  useWhatsappWebhookErrors,
} from "@/lib/queries/whatsapp";
import { toast } from "sonner";

export const WebhookTab = ({ canManage }: { canManage: boolean }) => {
  const { data: hooks, isLoading, error } = useWhatsappWebhook(true);
  const reconcile = useReconcileWhatsappWebhook();

  const run = () =>
    reconcile.mutate(undefined, {
      onSuccess: () => toast.success("Webhook reconfigurado"),
      onError: (err: { message?: string }) => toast.error(err.message ?? "Não foi possível reconfigurar"),
    });

  const ours = hooks?.find((hook) => hook.isOurs);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sincronização automática</CardTitle>
        <CardDescription>
          O servidor de WhatsApp avisa o elosCRM sempre que a conexão muda de estado. Sem isso, o
          estado só atualiza quando alguém clica em Sincronizar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && <Skeleton className="h-20 w-full" />}

        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Não foi possível consultar o webhook</AlertTitle>
            <AlertDescription>{(error as { message?: string }).message}</AlertDescription>
          </Alert>
        )}

        {/* Registrado para outra URL é o caso comum em desenvolvimento: o túnel muda de endereço a
            cada reinício. Misturar com "não registrado" faria o alerta gritar erro por rotina. */}
        {hooks && !ours && hooks.length > 0 && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Webhook aponta para outro endereço</AlertTitle>
            <AlertDescription>
              Há webhook registrado, mas não para este servidor. Use Reconfigurar para apontá-lo aqui.
            </AlertDescription>
          </Alert>
        )}

        {hooks && hooks.length === 0 && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Webhook não registrado</AlertTitle>
            <AlertDescription>
              A conexão funciona, mas mudanças de estado não chegam sozinhas. Use Reconfigurar.
            </AlertDescription>
          </Alert>
        )}

        {ours && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Ativo e apontando para o elosCRM
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ours.events.map((event) => (
                <Badge key={event} variant="secondary">
                  {event}
                </Badge>
              ))}
            </div>
            {/* o último segmento é o segredo do webhook e vem mascarado pela API */}
            <code className="text-muted-foreground bg-muted rounded p-2 text-xs break-all">{ours.url}</code>
          </div>
        )}

        {canManage && (
          <div>
            <Button variant="outline" onClick={run} disabled={reconcile.isPending}>
              <RefreshCw />
              Reconfigurar webhook
            </Button>
          </div>
        )}

        <DeliveryErrors />
      </CardContent>
    </Card>
  );
};

/**
 * Falhas de entrega respondem à pergunta "o webhook está registrado, então por que o status não
 * atualiza?". Sem isso, o único jeito de descobrir seria o painel da uazapi.
 */
const DeliveryErrors = () => {
  const { data, isLoading } = useWhatsappWebhookErrors(true);

  if (isLoading || !data) return null;

  return (
    <div className="border-t pt-4">
      <h3 className="mb-2 text-sm font-medium">Falhas de entrega recentes</h3>

      {data.errors.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhuma falha registrada
          {data.captureStartedAt &&
            ` desde ${format(parseISO(data.captureStartedAt), "dd/MM 'às' HH:mm", { locale: ptBR })}`}
          .
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.errors.slice(0, 10).map((entry, index) => (
            <div key={`${entry.created}-${index}`} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">{entry.status_code ?? "sem resposta"}</Badge>
                <span className="font-medium">{entry.event}</span>
                <span className="text-muted-foreground text-xs">
                  {format(parseISO(entry.created), "dd/MM HH:mm", { locale: ptBR })} ·{" "}
                  {entry.attempts} tentativa{entry.attempts === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs break-all">{entry.error}</p>
            </div>
          ))}
          {data.errors.length > 10 && (
            <p className="text-muted-foreground text-xs">
              e mais {data.errors.length - 10} falha{data.errors.length - 10 === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
