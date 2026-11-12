"use client";

import { useEffect, useRef } from "react";
import { useQueryStates, parseAsString } from "nuqs";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useRefreshHubConnection, useStartHubSession } from "@/lib/queries/whatsapp-hub";

// códigos da volta do hub (hub:531-544); desconhecido cai na mensagem genérica
const returnErrors: Record<string, string> = {
  COEXISTENCE_REQUIRED: "O número escolhido não está no app WhatsApp Business. Abra um link novo e, na janela da Meta, escolha conectar o app WhatsApp Business existente.",
  COEXISTENCE_INCOMPLETE: "O número ainda está terminando a migração para a API. Tente de novo em alguns minutos.",
  PHONE_ALREADY_CONNECTED: "Este número já está conectado em outra conta. Fale com o suporte.",
  WABA_ALREADY_CONNECTED: "Esta conta do WhatsApp Business já está conectada em outra conta. Fale com o suporte.",
  META_PHONE_AMBIGUOUS: "A Meta não informou qual número conectar. Fale com o suporte.",
};
const fallbackError = "Não foi possível concluir a conexão. Tente de novo com um link novo.";

export const HubConnect = () => {
  const [query, setQuery] = useQueryStates({ status: parseAsString, connectionId: parseAsString, code: parseAsString });
  const start = useStartHubSession();
  const refresh = useRefreshHubConnection();
  const handled = useRef(false);

  // a volta do hub é só dica de interface (hub:538): quem confirma é o refresh, que relê no hub.
  // status=error fica na URL até o próximo clique, e a mensagem sai dela no render.
  useEffect(() => {
    if (handled.current || !query.status || query.status === "error") return;
    handled.current = true;
    const { status, connectionId } = query;
    void setQuery({ status: null, connectionId: null, code: null });
    if (status === "connected" && connectionId) refresh.mutate(connectionId, { onSuccess: () => toast.success("Número conectado. A ativação termina em instantes.") });
    else if (status === "cancelled") toast.info("Conexão cancelada.");
  }, [query, refresh, setQuery]);

  const returnError = refresh.error ? (refresh.error as unknown as ApiError).message || fallbackError
    : query.status === "error" ? returnErrors[query.code ?? ""] ?? fallbackError : null;

  const connect = () => {
    refresh.reset();
    void setQuery({ status: null, connectionId: null, code: null });
    start.mutate(undefined, {
      // a url é de uso único e leva token (hub:507): só navega, não guarda nem exibe
      onSuccess: session => window.location.assign(session.url),
      onError: error => toast.error((error as unknown as ApiError).message || "Não foi possível abrir a conexão"),
    });
  };

  return <div className="flex flex-col gap-3">
    <p className="text-muted-foreground text-sm">Use o número que já está no app WhatsApp Business. Ele continua funcionando no celular.</p>
    <div><Button onClick={connect} disabled={start.isPending || refresh.isPending}>{start.isPending ? "Abrindo..." : refresh.isPending ? "Confirmando conexão..." : "Conectar número"}</Button></div>
    {returnError && <Alert variant="destructive"><AlertTitle>A conexão não foi concluída</AlertTitle><AlertDescription>{returnError}</AlertDescription></Alert>}
  </div>;
};
