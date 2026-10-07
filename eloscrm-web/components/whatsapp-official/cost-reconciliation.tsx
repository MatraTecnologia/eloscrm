"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import { useCostReconciliations } from "@/lib/queries/whatsapp-costs";
import type { CostPeriod } from "@/lib/cost-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCost } from "./cost-format";

export const CostReconciliationPanel = ({ period, currency, enabled }: { period: CostPeriod; currency: string | null; enabled: boolean }) => {
  const records = useCostReconciliations(period, enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !enabled) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(null);
    try {
      await api.post("/whatsapp/costs/reconciliations", { ...period, documentReference: values.get("documentReference"), reportedTotal: String(values.get("reportedTotal")).replace(",", "."),
        ...(values.get("declaredFees") ? { declaredFees: String(values.get("declaredFees")).replace(",", ".") } : {}),
        ...(values.get("declaredTaxes") ? { declaredTaxes: String(values.get("declaredTaxes")).replace(",", ".") } : {}),
        ...(values.get("note") ? { note: values.get("note") } : {}) });
      await records.refetch(); form.reset(); toast.success("Conferência declarada registrada");
    } catch (failure) { setError((failure as ApiError).message); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-t pt-5"><h3 className="text-lg font-semibold">Conferência com documento financeiro</h3>
    <p className="text-sm text-muted-foreground">Documento da WABA no período selecionado, em {currency ?? "moeda não identificada"}. Referência e valores são declarados pelo gestor, sem verificação automática na Meta. Cada registro preserva as apurações disponíveis naquele momento.</p>
    <details className="rounded-md border p-3"><summary className="cursor-pointer font-medium">Registrar conferência</summary><form onSubmit={save} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Referência do documento<Input name="documentReference" maxLength={200} required /></label><label className="text-sm">Total do documento<Input name="reportedTotal" inputMode="decimal" required /></label><label className="text-sm">Taxas incluídas (opcional)<Input name="declaredFees" inputMode="decimal" /></label><label className="text-sm">Impostos incluídos (opcional)<Input name="declaredTaxes" inputMode="decimal" /></label></div>
      <label className="block text-sm">Observação (opcional)<Input name="note" maxLength={1000} /></label>
      <p className="text-xs text-muted-foreground">{"Informe somente taxas e impostos incluídos no total. Campos vazios indicam informação ausente. Correções exigem novo registro; os anteriores permanecem disponíveis."}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || !enabled || !currency}>{busy ? "Registrando…" : "Registrar valores declarados"}</Button>
    </form></details>
    {records.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as conferências.</p>}
    {records.data?.map(record => <details key={record.id} className="rounded-md border p-3"><summary className="cursor-pointer text-sm">{record.documentReference} · {formatCost(record.reportedTotal, record.currency)} · {new Date(record.createdAt).toLocaleString("pt-BR")}</summary><div className="mt-3 space-y-2 text-sm">
      <p>Taxas: {formatCost(record.declaredFees, record.currency)} · Impostos: {formatCost(record.declaredTaxes, record.currency)}</p>
      <p>Diferença perante o agregado Meta: {formatCost(record.snapshot.differenceFromMeta, record.currency)}</p>
      <p>Diferença perante a estimativa desta conexão: {formatCost(record.snapshot.differenceFromLocalEstimate, record.currency)}</p>
      <p className="text-muted-foreground">{record.snapshot.assessed} entregas apuradas · {record.snapshot.unresolved} sem valor · {record.snapshot.counts.pending} pendentes · {record.snapshot.counts.uncertain} incertos</p>
      {record.note && <p>{record.note}</p>}{record.snapshot.limitations.map(text => <p key={text} className="text-xs text-muted-foreground">{text}</p>)}
    </div></details>)}
    {records.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conferência declarada neste período.</p>}
  </section>;
};
