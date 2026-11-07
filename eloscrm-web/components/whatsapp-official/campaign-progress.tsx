"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { CampaignPreview } from "@/lib/campaign-types";
import { useOfficialCampaign, useCampaignAction } from "@/lib/queries/whatsapp-campaigns";
import { Button } from "@/components/ui/button";
import { formatCost } from "./cost-format";
import { CampaignRecipientReport } from "./campaign-recipient-report";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";

export const campaignStatus: Record<string, string> = { draft: "Rascunho", running: "Enviando", paused: "Pausada", needs_review: "Revisão necessária", done: "Concluída", canceled: "Cancelada", pending: "Na fila", preparing: "Preparando", sent: "Aceita pela Meta", failed: "Falhou", skipped: "Excluída", unknown: "Resultado incerto" };
export const CampaignProgress = ({ id }: { id: string }) => {
  const query = useOfficialCampaign(id); const action = useCampaignAction(); const [revised, setRevised] = useState<CampaignPreview | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const campaign = query.data;
  const [confirmation, setConfirmation] = useState<"start" | "cancel" | null>(null);
  const run = async (next: "start" | "refresh" | "cancel" | "pause" | "resume", previewHash?: string) => {
    setError(null);
    try { await action.mutateAsync({ id, action: next, previewHash }); setRevised(null); setConfirmation(null); }
    catch (error) { setError((error as { message?: string }).message ?? "Não foi possível atualizar a campanha"); }
  };
  const revise = async () => { setBusy(true); setError(null); try { setRevised((await api.post<CampaignPreview>(`/whatsapp/campaigns/${id}/preview`, {})).data); } catch (error) { setError((error as { message?: string }).message ?? "Não foi possível atualizar a previsão"); } finally { setBusy(false); } };
  if (!campaign) return <p role="status">{query.isError ? "Não foi possível consultar a campanha" : "Carregando campanha…"}</p>;
  const canStart = campaign.status === "draft"; const needsReview = campaign.status === "needs_review";
  const partial = campaign.recipients.some(row => row.commandId || ["sent", "failed", "skipped", "unknown"].includes(row.status));
  // O motivo da pausa automática fica no destinatário que voltou para a fila.
  const held = campaign.recipients.find(row => row.status === "pending" && row.safeError);
  const pauseReason = held?.safeError?.replace(/\.$/, "") ?? (needsReview && partial ? "A campanha foi pausada para revisão" : null);
  // Template ou arquivo mudou, ou quem criou deixou de ser gestor: a API recusaria a retomada.
  const blocked = ["CAMPAIGN_TEMPLATE_CHANGED", "FORBIDDEN"].includes(held?.errorCode ?? "");
  const completed = campaign.recipients.filter(row => ["sent", "failed", "skipped", "unknown"].includes(row.status)).length;
  const accepted = campaign.recipients.filter(row => row.status === "sent").length;
  const errors = campaign.recipients.filter(row => row.status === "failed" || row.deliveryStatus === "failed").length;
  const delivered = campaign.recipients.filter(row => ["delivered", "read"].includes(row.deliveryStatus ?? "")).length;
  return <div className="min-w-0 space-y-3">
    <p className="font-medium">{campaign.name} · {campaignStatus[campaign.status] ?? "Indisponível"}</p>
    <p className="text-sm">Previsão aprovada: {formatCost(campaign.snapshot.estimate.amount, campaign.snapshot.estimate.currency)} · {campaign.snapshot.eligible} {campaign.snapshot.eligible === 1 ? "pessoa" : "pessoas"}{" · 1 mensagem por pessoa"}</p>
    <p className="text-xs text-muted-foreground">{campaign.snapshot.estimate.assumption}{" Aceite da Meta não confirma entrega. Cancelar impede o restante; envios já submetidos permanecem."}</p>
    <div className="flex flex-wrap gap-2">
      {canStart && <Button disabled={action.isPending || busy || !!revised} onClick={() => setConfirmation("start")}>{action.isPending ? "Confirmando…" : "Confirmar início"}</Button>}
      {(campaign.status === "running" || ((campaign.status === "paused" || (needsReview && partial)) && !blocked)) && <Button variant="outline" disabled={action.isPending || busy} onClick={() => void run(campaign.status === "running" ? "pause" : "resume")}>{campaign.status === "running" ? "Pausar" : "Continuar"}</Button>}
      {(canStart || needsReview) && !partial && <Button variant="outline" disabled={action.isPending || busy} onClick={() => void revise()}>Atualizar previsão</Button>}
      {!["done", "canceled"].includes(campaign.status) && <Button variant="outline" disabled={action.isPending || busy} onClick={() => setConfirmation("cancel")}>Encerrar disparo</Button>}
    </div>
    <p className="text-xs text-muted-foreground">A fila continua no servidor com o app fechado. Pausar impede novas tentativas; o envio em andamento pode concluir. Continuar mantém os resultados já registrados.</p>
    <Progress value={campaign.recipients.length ? completed / campaign.recipients.length * 100 : 0} />
    <p className="text-sm tabular-nums">{completed}/{campaign.recipients.length} processadas · {accepted} aceitas · {delivered} entregues · {errors} falhas</p>
    {pauseReason && ["paused", "needs_review"].includes(campaign.status) && <p role="alert" className="text-sm">{pauseReason}. {blocked ? "Encerre o disparo. Na campanha nova, desmarque quem já recebeu (veja o relatório abaixo): o CRM ainda não impede o reenvio." : needsReview && !partial ? "Atualize a previsão para iniciar." : "Resolva e clique em Continuar; quem já recebeu não recebe de novo."}</p>}
    {revised && <div className="space-y-2 rounded-md border p-3"><p className="text-sm">Nova previsão: {formatCost(revised.estimate.amount, revised.estimate.currency)} · {revised.eligible} elegíveis · {revised.excluded} excluídos</p>{revised.rows.map(row => <p key={row.dealId} className="text-xs">{row.clientName}: {row.exclusion ?? formatCost(row.cost.amount, row.cost.currency)}{row.text && <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{row.text}</span>}</p>)}<Button variant="outline" disabled={action.isPending} onClick={() => void run("refresh", revised.previewHash)}>Aprovar nova previsão</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <CampaignRecipientReport campaignId={campaign.id} rows={campaign.recipients.map(row => ({ id: row.id, name: row.clientName, destination: row.destination, status: row.deliveryStatus === "failed" ? "delivery_failed" : row.status, label: row.deliveryStatus === "read" ? "Lida" : row.deliveryStatus === "delivered" ? "Entregue" : row.deliveryStatus === "failed" ? "Falha na entrega" : campaignStatus[row.status] ?? "Indisponível", error: row.safeError, code: row.errorCode, stage: row.errorStage, attempts: row.attempts, startedAt: row.startedAt, completedAt: row.completedAt, text: campaign.snapshot.rows.find(target => target.dealId === row.dealId)?.text, cost: row.cost ? formatCost(row.cost.amount, row.cost.currency) : null }))} />
    <AlertDialog open={!!confirmation} onOpenChange={open => { if (!open && !action.isPending) setConfirmation(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation === "start" ? "Iniciar disparo oficial?" : "Encerrar disparo oficial?"}</AlertDialogTitle><AlertDialogDescription>{confirmation === "start" ? `O template ${campaign.snapshot.template.name} será enviado para ${campaign.snapshot.eligible} pessoas. Previsão: ${formatCost(campaign.snapshot.estimate.amount, campaign.snapshot.estimate.currency)}. A cobrança depende das entregas e tarifas aplicáveis.` : "Os destinatários ainda na fila serão cancelados. Mensagens já submetidas poderão concluir. Esta campanha não poderá ser retomada após o encerramento."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={action.isPending}>Voltar</AlertDialogCancel><Button variant={confirmation === "cancel" ? "destructive" : "default"} disabled={action.isPending} onClick={() => { if (confirmation) void run(confirmation, confirmation === "start" ? campaign.snapshot.previewHash : undefined); }}>{action.isPending ? "Confirmando…" : confirmation === "start" ? "Confirmar início" : "Encerrar disparo"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
};
