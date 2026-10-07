"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { CampaignPreview } from "@/lib/campaign-types";
import { useOfficialCampaign, useCampaignAction } from "@/lib/queries/whatsapp-campaigns";
import { Button } from "@/components/ui/button";
import { formatCost } from "./cost-format";

export const campaignStatus: Record<string, string> = { draft: "Rascunho", running: "Enviando", needs_review: "Revisão necessária", done: "Concluída", canceled: "Cancelada", pending: "Na fila", preparing: "Preparando", sent: "Aceita pela Meta", failed: "Falhou", skipped: "Excluída", unknown: "Resultado incerto" };
export const CampaignProgress = ({ id }: { id: string }) => {
  const query = useOfficialCampaign(id); const action = useCampaignAction(); const [revised, setRevised] = useState<CampaignPreview | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const campaign = query.data;
  const run = async (next: "start" | "refresh" | "cancel", previewHash?: string) => {
    setError(null);
    try { await action.mutateAsync({ id, action: next, previewHash }); setRevised(null); }
    catch (error) { setError((error as { message?: string }).message ?? "Não foi possível atualizar a campanha"); }
  };
  const revise = async () => { setBusy(true); setError(null); try { setRevised((await api.post<CampaignPreview>(`/whatsapp/campaigns/${id}/preview`, {})).data); } catch (error) { setError((error as { message?: string }).message ?? "Não foi possível atualizar a previsão"); } finally { setBusy(false); } };
  if (!campaign) return <p role="status">{query.isError ? "Não foi possível consultar a campanha" : "Carregando campanha…"}</p>;
  const canStart = campaign.status === "draft"; const needsReview = campaign.status === "needs_review";
  const partial = campaign.recipients.some(row => row.commandId);
  return <div className="min-w-0 space-y-3">
    <p className="font-medium">{campaign.name} · {campaignStatus[campaign.status] ?? "Indisponível"}</p>
    <p className="text-sm">Previsão aprovada: {formatCost(campaign.snapshot.estimate.amount, campaign.snapshot.estimate.currency)} · {campaign.snapshot.eligible} {campaign.snapshot.eligible === 1 ? "pessoa" : "pessoas"}{" · 1 mensagem por pessoa"}</p>
    <p className="text-xs text-muted-foreground">{campaign.snapshot.estimate.assumption}{" Aceite da Meta não confirma entrega. Cancelar impede o restante; envios já submetidos permanecem."}</p>
    <div className="flex flex-wrap gap-2">
      {canStart && <Button disabled={action.isPending || busy || !!revised} onClick={() => void run("start", campaign.snapshot.previewHash)}>{action.isPending ? "Confirmando…" : "Confirmar início"}</Button>}
      {(canStart || needsReview) && !partial && <Button variant="outline" disabled={action.isPending || busy} onClick={() => void revise()}>Atualizar previsão</Button>}
      {!["done", "canceled"].includes(campaign.status) && <Button variant="outline" disabled={action.isPending || busy} onClick={() => void run("cancel")}>Cancelar o restante</Button>}
    </div>
    {needsReview && partial && <p role="alert" className="text-sm">A campanha foi pausada após preparar envios. Cancele o restante e crie outra campanha para quem ainda não recebeu.</p>}
    {revised && <div className="space-y-2 rounded-md border p-3"><p className="text-sm">Nova previsão: {formatCost(revised.estimate.amount, revised.estimate.currency)} · {revised.eligible} elegíveis · {revised.excluded} excluídos</p>{revised.rows.map(row => <p key={row.dealId} className="text-xs">{row.clientName}: {row.exclusion ?? formatCost(row.cost.amount, row.cost.currency)}{row.text && <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{row.text}</span>}</p>)}<Button variant="outline" disabled={action.isPending} onClick={() => void run("refresh", revised.previewHash)}>Aprovar nova previsão</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ul className="space-y-2">{campaign.recipients.map(row => <li key={row.id} className="border-b py-2 text-sm"><p className="break-words">{row.clientName} · {campaignStatus[row.status] ?? "Indisponível"}{row.deliveryStatus === "read" ? " · Lida" : row.deliveryStatus === "delivered" ? " · Entregue" : row.deliveryStatus === "failed" ? " · Falha na entrega" : ""}</p>{campaign.snapshot.rows.find(target => target.dealId === row.dealId)?.text && <p className="mt-1 whitespace-pre-wrap break-words">{campaign.snapshot.rows.find(target => target.dealId === row.dealId)?.text}</p>}{row.safeError && <p className="text-xs text-muted-foreground">{row.safeError}</p>}{row.cost && <p className="text-xs">Apuração estimada: {formatCost(row.cost.amount, row.cost.currency)}</p>}</li>)}</ul>
  </div>;
};
