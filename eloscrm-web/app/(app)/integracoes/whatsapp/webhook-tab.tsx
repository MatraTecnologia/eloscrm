"use client";

import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useReconcileWhatsappWebhook, useWhatsappWebhook } from "@/lib/queries/whatsapp";
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
      </CardContent>
    </Card>
  );
};
