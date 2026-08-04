"use client";

import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhatsappLimits } from "@/lib/queries/whatsapp";

/**
 * A uazapi manda epoch (`1970-01-01T00:00:01Z`) para "não informado" em vez de omitir o campo —
 * sem este filtro a tela anunciaria "renova em 31/12 às 21:00".
 */
const when = (value?: string) => {
  if (!value) return null;
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 2000) return null;
  return format(parsed, "dd/MM 'às' HH:mm", { locale: ptBR });
};

export const DiagnosticsTab = () => {
  const { data, isLoading, error, refetch, isRefetching } = useWhatsappLimits(true);

  const capping = data?.new_chat_message_capping;
  const hasQuota = Boolean(capping?.available && (capping.total_quota ?? 0) > 0);
  const timelocked = Boolean(data?.reachout_timelock?.active);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagnóstico de envio</CardTitle>
        <CardDescription>
          O WhatsApp limita quantas conversas novas um número pode iniciar. Quando esse limite
          estoura, mensagens para quem nunca falou com você param de sair — e o CRM não tem como
          contornar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && <Skeleton className="h-32 w-full" />}

        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Não foi possível consultar</AlertTitle>
            <AlertDescription>{(error as { message?: string }).message}</AlertDescription>
          </Alert>
        )}

        {data && (
          <>
            <Alert variant={data.can_send_new_messages === false ? "destructive" : "default"}>
              {data.can_send_new_messages === false ? <TriangleAlert /> : <CheckCircle2 />}
              <AlertTitle>
                {data.can_send_new_messages === false
                  ? "Este número não pode iniciar conversas novas agora"
                  : data.can_send_new_messages === true
                    ? "Pode iniciar conversas novas"
                    : "Situação indeterminada"}
              </AlertTitle>
              <AlertDescription>{data.message_ptbr || data.message}</AlertDescription>
            </Alert>

            {/* `available` diz que a consulta funcionou, não que existe cota: número sem capping
                volta com total_quota 0. Mostrar "0 de 0 usadas" seria ruído. */}
            {hasQuota && capping && (
              <div className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cota de conversas novas</span>
                  {capping.status && (
                    <Badge variant={capping.status === "CAPPED" ? "destructive" : "secondary"}>
                      {capping.status === "CAPPED" ? "No limite" : "Normal"}
                    </Badge>
                  )}
                </div>
                <Progress
                  value={Math.min(
                    100,
                    ((capping.used_quota ?? 0) / Math.max(1, capping.total_quota ?? 1)) * 100,
                  )}
                />
                <span className="text-muted-foreground text-sm">
                  {capping.used_quota ?? 0} de {capping.total_quota} usadas
                  {when(capping.cycle_end) && ` · renova em ${when(capping.cycle_end)}`}
                </span>
              </div>
            )}

            {timelocked && data.reachout_timelock && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Envio bloqueado temporariamente</AlertTitle>
                <AlertDescription>
                  {when(data.reachout_timelock.until)
                    ? `O WhatsApp liberou novas tentativas a partir de ${when(data.reachout_timelock.until)}.`
                    : "O WhatsApp pausou os envios deste número por tempo indeterminado."}
                </AlertDescription>
              </Alert>
            )}

            {/* sem cota e sem bloqueio é o caso normal de número saudável; dizer isso evita que o
                card pareça quebrado */}
            {!hasQuota && !timelocked && (
              <p className="text-muted-foreground text-sm">
                O WhatsApp não aplica nenhuma cota a este número no momento.
              </p>
            )}

            <div>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw />
                Consultar de novo
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
