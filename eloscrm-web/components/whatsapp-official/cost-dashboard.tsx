"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useOfficialConnections } from "@/lib/queries/whatsapp-official";
import { useCostReport, useCostRates, useCostScopes } from "@/lib/queries/whatsapp-costs";
import { useActiveOrganization } from "@/lib/auth-client";
import type { ChannelConnection } from "@/lib/types";
import { categoryLabels, costLabels, formatCost } from "./cost-format";
import { CostRateForm } from "./cost-rate-form";
import { CostReconciliationPanel } from "./cost-reconciliation";
import { CostRateImport } from "./cost-rate-import";
import { CostRecipientMarket } from "./cost-recipient-market";
import { CostSimulator } from "./cost-simulator";

const CostPanel = ({ channel }: { channel: ChannelConnection }) => {
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const endAt = new Date(`${end}T00:00:00.000Z`).getTime() + 86400000;
  const valid = !!start && !!end && endAt > Date.parse(start) && endAt - Date.parse(start) <= 31 * 86400000;
  const period = { connectionId: channel.id, start: `${start}T00:00:00.000Z`, end: Number.isFinite(endAt) ? new Date(endAt).toISOString() : "" };
  const [filterType, setFilterType] = useState<"contactId" | "conversationId" | "campaignId">("contactId");
  const [filterId, setFilterId] = useState("");
  const scopes = useCostScopes(channel.id);
  const filterOptions = filterType === "contactId" ? scopes.data?.contacts : filterType === "conversationId" ? scopes.data?.conversations : scopes.data?.campaigns;
  const report = useCostReport({ ...period, ...(filterId ? { [filterType]: filterId } : {}) }, valid);
  const rates = useCostRates(channel.id);
  const [busy, setBusy] = useState(false);
  const action = async (type: "sync" | "assess") => {
    if (busy || !valid) return; setBusy(true);
    try {
      const result = await api.post<{ status?: string; unmatched?: number }>(`/whatsapp/costs/${type}`, period);
      await report.refetch();
      if (result.data.status === "unavailable") toast.error("A consulta à Meta falhou. O último snapshot foi preservado.");
      else if (type === "assess") toast.success("Apuração concluída" + (result.data.unmatched ? "; " + result.data.unmatched + " IDs sem mensagem correspondente" : ""));
      else toast.success("Snapshot da Meta atualizado");
    } catch (error) { toast.error((error as ApiError).message); }
    finally { setBusy(false); }
  };
  const data = report.data;
  const analytics = data?.analytics;
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">De<Input type="date" value={start} onChange={event => setStart(event.target.value)} disabled={busy} /></label><label className="text-sm">Até (inclusive)<Input type="date" value={end} onChange={event => setEnd(event.target.value)} disabled={busy} /></label><Button variant="outline" onClick={() => action("sync")} disabled={busy || !valid}>Consultar Meta</Button><Button variant="outline" onClick={() => action("assess")} disabled={busy || !valid}>Apurar/revisar entregas</Button></div>
    <p className="text-xs text-muted-foreground">Datas em UTC. Até 31 dias por consulta. Apurar/revisar aplica tarifas cadastradas às entregas e guarda as versões anteriores.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Recorte da estimativa<select className="block h-9 rounded-md border bg-background px-2" value={filterType} onChange={event => { setFilterType(event.target.value as typeof filterType); setFilterId(""); }}><option value="contactId">Contato</option><option value="conversationId">Atendimento</option><option value="campaignId">Campanha</option></select></label><label className="text-sm">Selecionar recorte<select className="block h-9 max-w-sm rounded-md border bg-background px-2" value={filterId} onChange={event => setFilterId(event.target.value)}><option value="">Toda a conexão</option>{filterOptions?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
    <p className="text-xs text-muted-foreground">O recorte altera apenas a estimativa local. O agregado Meta e a conferência financeira abrangem a WABA. Listas exibem até 200 opções recentes.</p>
    {scopes.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os recortes.</p>}
    {!valid && <p role="alert" className="text-sm text-destructive">Selecione um período válido de até 31 dias.</p>}
    {report.isLoading && <Skeleton className="h-32" />}
    {report.isError && <p role="alert" className="text-sm text-destructive">{report.error.message}<Button variant="ghost" onClick={() => report.refetch()}>Tentar novamente</Button></p>}
    {data && valid && <>
      <section className="space-y-2"><h3 className="text-lg font-semibold">Consumo registrado no CRM</h3><p className="text-sm">{data.counts.official}{" envios oficiais · "}{data.counts.businessApp}{" pelo celular · "}{data.counts.history}{" importados"}</p><p className="text-sm text-muted-foreground">{data.counts.pending}{" pendentes · "}{data.counts.uncertain}{" incertos · "}{data.counts.failed}{" falhos. Contagem por data de envio; ecos e importações não recebem tarifa de API."}</p>
        <p className="font-medium">Subtotal estimado das entregas apuradas: {data.subtotals.length ? data.subtotals.map(total => formatCost(total.amount, total.currency)).join(" · ") : "Indisponível"}</p><p className="text-sm text-muted-foreground">{data.assessed}{" entregas apuradas · "}{data.unresolved}{" sem valor calculável. O subtotal considera só as parcelas conhecidas, pela data de entrega. Sem desconto de volume confirmado; não é fatura."}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Entrega</th><th className="p-2">Mercado/categoria</th><th className="p-2">Estimativa</th><th className="p-2">Apuração</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id} className="border-b"><td className="whitespace-nowrap p-2">{new Date(item.deliveredAt).toLocaleString("pt-BR", { timeZone: "UTC" })}</td><td className="p-2">{item.country ?? "Não identificado"} · {categoryLabels[item.category ?? ""] ?? item.category ?? "Sem classificação"}</td><td className="whitespace-nowrap p-2">{formatCost(item.amount, item.currency)}</td><td className="p-2">{costLabels[item.state] ?? item.state} · versão {item.revision}{item.rateSnapshot && <a className="ml-2 underline" href={item.rateSnapshot.sourceUrl} target="_blank" rel="noreferrer">Fonte</a>}</td></tr>)}</tbody></table></div>
        {!data.items.length && <p className="text-sm text-muted-foreground">Nenhuma apuração neste período. Ausência de apuração não comprova gasto zero.</p>}{data.truncated && <p className="text-xs text-muted-foreground">Mostrando as 100 entregas mais recentes. O subtotal inclui todas as apuradas no período.</p>}
      </section>
      <section className="space-y-2 border-t pt-5"><h3 className="text-lg font-semibold">Reportado pela Meta</h3><p className="text-sm text-muted-foreground">Agregado de toda a WABA, inclusive outros números e tráfego externo ao CRM. Valor aproximado, separado do subtotal local.</p>
        <p className="font-medium">{formatCost(analytics?.total ?? null, analytics?.currency ?? null)}</p><p className="text-sm">{analytics?.volume === null || analytics?.volume === undefined ? "Volume indisponível" : `${analytics.volume} mensagens reportadas`}</p>
        {analytics?.syncedAt && <p className="text-xs text-muted-foreground">Último snapshot: {new Date(analytics.syncedAt).toLocaleString("pt-BR")} · versão {analytics.revision}</p>}
        {analytics?.safeError && <p role="status" className="text-sm">{analytics.safeError}</p>}{!analytics && <p className="text-sm">Use “Consultar Meta” para buscar o recorte. Métrica ausente não equivale a gasto zero.</p>}
        {analytics && analytics.points.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr className="border-b"><th className="p-2">País/categoria</th><th className="p-2">Tipo/faixa</th><th className="p-2">Volume</th><th className="p-2">Custo aproximado</th></tr></thead><tbody>{analytics.points.slice(0, 100).map((point, index) => <tr key={index} className="border-b"><td className="p-2">{point.country ?? "Não informado"} · {point.category ?? "Não informada"}</td><td className="p-2">{point.pricingType ?? "Não informado"} · {point.tier ?? "Sem faixa"}</td><td className="p-2">{point.volume ?? "Indisponível"}</td><td className="whitespace-nowrap p-2">{formatCost(point.cost, analytics.currency)}</td></tr>)}</tbody></table></div>}
        <p className="text-xs text-muted-foreground">Não some este valor ao subtotal estimado. Confira os documentos financeiros na seção abaixo.</p>
      </section>
    </>}
    <CostReconciliationPanel period={period} currency={channel.currency} enabled={valid} />
    <section className="space-y-3 border-t pt-5"><h3 className="text-lg font-semibold">Tarifas e vigência</h3>{rates.isError && <p role="alert" className="text-sm">Não foi possível carregar as tarifas.</p>}<p className="text-sm text-muted-foreground">{rates.data?.length ?? 0} tarifas cadastradas nesta WABA. Nenhum valor padrão é aplicado.</p><CostRateForm connectionId={channel.id} currency={channel.currency} onSaved={() => { void rates.refetch(); }} />
      <CostRateImport connectionId={channel.id} currency={channel.currency} onSaved={() => { void rates.refetch(); }} />
      <CostRecipientMarket connectionId={channel.id} contacts={scopes.data?.contacts ?? []} onSaved={() => { void scopes.refetch(); }} />
      {!!rates.data?.length && <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr className="border-b"><th className="p-2">País/categoria</th><th className="p-2">Valor</th><th className="p-2">Vigência/faixa</th><th className="p-2">Fonte</th></tr></thead><tbody>{rates.data.map(rate => <tr key={rate.id} className="border-b"><td className="p-2">{rate.country} · {categoryLabels[rate.category] ?? rate.category} · {rate.pricingType}</td><td className="whitespace-nowrap p-2">{formatCost(rate.unitRate, rate.currency)}</td><td className="p-2">{rate.validFrom.slice(0, 10)} a {rate.validUntil.slice(0, 10)} (fim exclusivo) · {rate.volumeFrom} a {rate.volumeUntil ?? "sem limite"}</td><td className="p-2"><a className="underline" href={rate.sourceUrl} target="_blank" rel="noreferrer">Fonte oficial</a></td></tr>)}</tbody></table></div>}
    </section>
    <CostSimulator connectionId={channel.id} />
  </div>;
};

export const CostDashboard = () => {
  const { data: org } = useActiveOrganization();
  const connections = useOfficialConnections();
  const [selectedId, setSelectedId] = useState("");
  const channel = connections.data?.find(item => item.id === selectedId) ?? connections.data?.[0];
  if (connections.isLoading) return <Skeleton className="h-48" />;
  if (connections.isError) return <p role="alert">Não foi possível carregar as conexões oficiais.</p>;
  if (!channel) return <p className="p-4 text-sm">Conecte um número oficial para consultar consumo e simular custos.</p>;
  return <div className="min-w-0 space-y-5 py-4"><div><h2 className="text-xl font-semibold">Custos e consumo</h2><p className="text-sm text-muted-foreground">Estimativas do CRM e snapshots da Meta na moeda original.</p></div><label className="block max-w-lg text-sm">Número oficial<select aria-label="Número oficial para custos" className="h-9 w-full rounded-md border bg-background px-2" value={channel.id} onChange={event => setSelectedId(event.target.value)}>{connections.data?.map(item => <option key={item.id} value={item.id}>{item.displayPhoneNumber ?? item.label}</option>)}</select></label><CostPanel key={`${org?.id}:${channel.id}`} channel={channel} /></div>;
};
