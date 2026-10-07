"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

type Entry = { id: string; name: string; origin: string; automationStatus: string; automationAttempts: number; automationErrorCode: string | null; createdAt: string };
const statusLabels: Record<string, string> = { pending: "Na fila", processed: "Processada", skipped: "Sem ação configurada", failed: "Falha recuperável" };
const reasonLabels: Record<string, string> = { AUTOMATION_AMBIGUOUS_PHONE: "Mais de um lead possui este telefone; revise o vínculo.", AUTOMATION_CLIENT_DISABLED: "Criação automática de lead desligada.", AUTOMATION_DISABLED: "Automação não configurada.", AUTOMATION_NOT_LIVE: "Somente mensagens recebidas ao vivo pelo WhatsApp oficial criam leads automaticamente.", AUTOMATION_CLIENT_UNAVAILABLE: "O lead vinculado não está disponível.", AUTOMATION_PROCESSING_FAILED: "Os efeitos falharam; a mensagem continua no atendimento." };
export const AutomationPanel = () => {
  const { data: org } = useActiveOrganization(); const qc = useQueryClient();
  const key = ["whatsapp-automations", org?.id];
  const query = useQuery({ queryKey: key, enabled: !!org?.id, refetchInterval: 10000, queryFn: async () => (await api.get<Entry[]>("/whatsapp/automations")).data });
  const retry = useMutation({ mutationFn: async (id: string) => api.post(`/whatsapp/automations/${id}/retry`, {}), onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); } });
  return <div className="space-y-4 py-3">
    <p className="text-sm text-muted-foreground">As regras de criação de lead, entrada no funil e distribuição valem somente para mensagens recebidas pelo WhatsApp oficial. A uazapi é usada para disparos e não registra mensagens recebidas. Histórico importado e mensagens enviadas pelo celular não acionam novas automações. Até 100 execuções recentes.</p>
    {query.isPending && <p role="status">Carregando automações…</p>}
    {(query.isError || retry.isError) && <p role="alert" className="text-sm text-destructive">{(retry.error as { message?: string } | null)?.message ?? "Não foi possível consultar as automações"}</p>}
    {query.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem processada pela automação ainda.</p>}
    <ul className="divide-y">{query.data?.map(row => <li key={row.id} className="space-y-1 py-3 text-sm"><p className="break-words font-medium">{row.name} · {statusLabels[row.automationStatus] ?? "Estado indisponível"}</p><p className="text-xs text-muted-foreground">{row.origin === "cloud_api" ? "WhatsApp oficial" : "uazapi"} · {new Date(row.createdAt).toLocaleString("pt-BR")} · {row.automationAttempts} {row.automationAttempts === 1 ? "tentativa" : "tentativas"}</p>{row.automationErrorCode && <p className="text-xs">{reasonLabels[row.automationErrorCode] ?? "Revise a configuração e o vínculo do contato."}</p>}{row.automationStatus === "failed" && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(row.id)}>Reprocessar automação</Button>}</li>)}</ul>
  </div>;
};
