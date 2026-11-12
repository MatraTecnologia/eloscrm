"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ChannelConnection } from "@/lib/types";

export const LifecycleControls = ({ connection }: { connection: ChannelConnection }) => {
  const [confirming, setConfirming] = useState(false);
  const cache = useQueryClient();
  const disable = useMutation({
    mutationFn: async () => (await api.post<{ uncertainCommands: number }>(`/whatsapp/maintenance/connections/${connection.id}/disable`, { confirm: "DISABLE_LOCAL" })).data,
    onSuccess: () => { setConfirming(false); void cache.invalidateQueries({ queryKey: ["whatsapp-official"] }); void cache.invalidateQueries({ queryKey: ["whatsapp-campaigns"] }); },
  });
  return <div className="flex flex-col gap-2 text-sm">
    {connection.status !== "disabled" && !confirming && <Button variant="outline" className="w-fit" onClick={() => setConfirming(true)}>Desativar no elosCRM</Button>}
    {confirming && <div className="flex flex-col gap-2">
      <p>Desativar bloqueia novos envios, cancela os envios ainda não submetidos e remove a credencial salva. O histórico permanece. Envios já submetidos podem chegar à Meta.</p>
      <div className="flex gap-2"><Button variant="destructive" disabled={disable.isPending} onClick={() => disable.mutate()}>Confirmar desativação local</Button><Button variant="outline" disabled={disable.isPending} onClick={() => setConfirming(false)}>Voltar</Button></div>
    </div>}
    {disable.error && <p role="alert" className="text-destructive">Não foi possível desativar a conexão.</p>}
    {disable.data && <p role="status">Conexão desativada no elosCRM.{disable.data.uncertainCommands > 0 ? ` ${disable.data.uncertainCommands} envio(s) aguardam confirmação.` : ""}</p>}
    {(connection.status === "disabled" || confirming) && <>
      <p className="text-muted-foreground">Não use “Desconectar conta” no WhatsApp Business do celular nem remova o número da plataforma da Meta: isso derruba a integração oficial do número, e as mensagens do intervalo não voltam na reconexão. A desativação aqui só interrompe o atendimento no elosCRM; o número continua funcionando no celular.</p>
      <p className="text-muted-foreground">A conexão oficial está mudando para um novo fluxo. Para voltar a atender aqui, fale com o suporte. Reconectar este número à mesma imobiliária preserva as conversas e os vínculos; não libera o número para outra imobiliária.</p>
    </>}
  </div>;
};
