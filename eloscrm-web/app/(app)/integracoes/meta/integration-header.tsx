"use client";

import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { KeyRound, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { MetaIcon } from "@/components/icons/meta";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDisconnectMeta, useSyncMetaLeads } from "@/lib/queries/meta";
import type { MetaIntegration } from "@/lib/types";
import { ConnectCard } from "./connect-card";

const tokenTypeLabels = { user: "token de usuário", system_user: "usuário do sistema" } as const;

type Props = { integration: MetaIntegration; canManage: boolean };

export const IntegrationHeader = ({ integration, canManage }: Props) => {
  const [replacing, setReplacing] = useState(false);
  const sync = useSyncMetaLeads();
  const disconnect = useDisconnectMeta();
  const onError = (err: { message?: string }) => toast.error(err.message ?? "A operação falhou");
  const invalid = integration.status === "token_invalid";

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <MetaIcon className="size-6" />
          </div>

          <div className="min-w-40 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{integration.metaUserName}</span>
              <Badge variant={invalid ? "destructive" : "default"}>
                {invalid ? "Token inválido" : "Conectado"}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {tokenTypeLabels[integration.tokenType]} · termina em {integration.tokenLast4}
              {integration.lastSyncAt && (
                <>
                  {" · última busca "}
                  {formatDistanceToNow(parseISO(integration.lastSyncAt), { addSuffix: true, locale: ptBR })}
                </>
              )}
            </p>
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={sync.isPending || invalid}
                onClick={() =>
                  sync.mutate(undefined, {
                    onSuccess: ({ ingested }) =>
                      toast.success(
                        ingested === 0 ? "Nenhum lead novo" : `${ingested} lead(s) novo(s) no funil`,
                      ),
                    onError,
                  })
                }
              >
                {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw />}
                Buscar leads agora
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReplacing((v) => !v)}>
                <KeyRound />
                Trocar token
              </Button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" size="sm">
                      <Unplug />
                      Desconectar
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar a conta do Meta?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A busca automática para e a configuração dos formulários é apagada. Os leads e
                      negócios já criados continuam no CRM.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        disconnect.mutate(undefined, {
                          onSuccess: () => toast.success("Conta do Meta desconectada"),
                          onError,
                        })
                      }
                    >
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>

      {(replacing || invalid) && canManage && <ConnectCard replacing onDone={() => setReplacing(false)} />}
    </>
  );
};
