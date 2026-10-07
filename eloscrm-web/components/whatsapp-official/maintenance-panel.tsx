"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";

type HistoryResult = { apply: boolean; items: { id: string; status: string; code?: string }[]; nextCursor: string | null };
type RetentionResult = { apply: boolean; journalPayloads: number; commandPayloads: number; journalDays: number; commandDays: number; hasMore: boolean };

const MaintenanceScope = () => {
  const [cursor, setCursor] = useState<string>();
  const cache = useQueryClient();
  const history = useMutation({
    mutationFn: async (apply: boolean) => (await api.post<HistoryResult>("/whatsapp/maintenance/history", { apply, cursor })).data,
    onSuccess: result => { if (result.apply) void cache.invalidateQueries({ queryKey: ["whatsapp-official"] }); },
  });
  const retention = useMutation({ mutationFn: async (apply: boolean) => (await api.post<RetentionResult>("/whatsapp/maintenance/retention", { apply })).data });
  const preview = history.data;
  const cleanup = retention.data;
  return <section className="flex flex-col gap-4 border-t pt-4">
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Histórico da uazapi</h3>
      <p className="text-muted-foreground text-sm">Vincule até 100 conversas por lote ao atendimento por contato. Mensagens e responsáveis são preservados; grupos permanecem separados. Contatos só são unidos por vínculo de lead existente ou identidade exata da mesma conexão.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={history.isPending} onClick={() => history.mutate(false)}>Analisar lote</Button>
        {preview && !preview.apply && preview.items.some(item => item.status === "ready") && <Button disabled={history.isPending} onClick={() => history.mutate(true)}>Confirmar vínculo deste lote</Button>}
        {preview?.nextCursor && <Button variant="outline" disabled={history.isPending} onClick={() => { setCursor(preview.nextCursor!); history.reset(); }}>Próximo lote</Button>}
      </div>
      {preview && <p role="status" className="text-sm">{preview.items.length} conversa(s) analisada(s). {preview.items.filter(item => item.status === "ready").length} pronta(s), {preview.items.filter(item => item.status === "linked").length} vinculada(s), {preview.items.filter(item => item.status === "review").length} exige(m) revisão.{preview.apply ? " Vínculos aplicados." : " Análise sem gravação."}</p>}
      {preview?.items.filter(item => item.status === "review").map(item => <p key={item.id} className="text-destructive text-sm">Conversa {item.id}: {item.code}</p>)}
      {history.error && <p role="alert" className="text-destructive text-sm">Não foi possível analisar o histórico.</p>}
    </div>
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Retenção de dados de processamento</h3>
      <p className="text-muted-foreground text-sm">Remove o conteúdo privado de eventos já processados e comandos concluídos. Conversas, mensagens, custos, auditoria e chaves que evitam duplicação permanecem. Eventos pendentes, falhos ou sem confirmação são preservados para recuperação.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={retention.isPending} onClick={() => retention.mutate(false)}>Analisar retenção</Button>{cleanup && !cleanup.apply && (cleanup.journalPayloads > 0 || cleanup.commandPayloads > 0) && <Button disabled={retention.isPending} onClick={() => retention.mutate(true)}>Confirmar limpeza do lote</Button>}</div>
      {cleanup && <p role="status" className="text-sm">{cleanup.journalPayloads} evento(s) com mais de {cleanup.journalDays} dias e {cleanup.commandPayloads} comando(s) com mais de {cleanup.commandDays} dias.{cleanup.apply ? " Conteúdo removido." : " Análise sem gravação."}{cleanup.hasMore ? " Há mais lotes para analisar." : ""}</p>}
      {retention.error && <p role="alert" className="text-destructive text-sm">Não foi possível consultar ou aplicar a retenção.</p>}
    </div>
  </section>;
};

export const MaintenancePanel = () => {
  const { data: org } = useActiveOrganization();
  return org ? <MaintenanceScope key={org.id} /> : null;
};
