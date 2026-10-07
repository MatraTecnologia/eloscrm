"use client";
import { useState } from "react";
import { api, type ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CostScenario, CostSimulation } from "@/lib/cost-types";
import { categoryLabels, formatCost } from "./cost-format";

const initialRow = () => ({ id: crypto.randomUUID(), country: "BR", category: "MARKETING", pricingType: "REGULAR", people: 1, messagesEach: 1, volumeBefore: 0 });
export const CostSimulator = ({ connectionId }: { connectionId: string }) => {
  const [rows, setRows] = useState(() => [initialRow()]);
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ scenario: string; data: CostSimulation } | null>(null);
  const input: CostScenario = { connectionId, at: `${at}T00:00:00.000Z`, rows: rows.map(row => ({ country: row.country, category: row.category, pricingType: row.pricingType, quantity: row.people * row.messagesEach, volumeBefore: row.volumeBefore })) };
  const scenario = JSON.stringify(input);
  const patch = (id: string, values: Partial<typeof rows[number]>) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...values } : row));
  const simulate = async () => {
    if (busy) return; setBusy(true); setError(null);
    try { setResult({ scenario, data: (await api.post<CostSimulation>("/whatsapp/costs/simulate", input)).data }); }
    catch (failure) { setError((failure as ApiError).message); }
    finally { setBusy(false); }
  };
  const current = result?.scenario === scenario ? result.data : null;
  return <section className="space-y-3 border-t pt-5"><h3 className="text-lg font-semibold">Simular envios e atendimento</h3><p className="text-sm text-muted-foreground">Informe o total de mensagens por pessoa, incluindo respostas futuras assumidas. Nenhuma mensagem será enviada.</p>
    <label className="block max-w-52 text-sm">Data da tarifa (UTC)<Input type="date" value={at} onChange={event => setAt(event.target.value)} /></label>
    {rows.map((row, index) => <fieldset key={row.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3"><legend className="px-1 text-sm">Cenário {index + 1}</legend>
      <label className="text-sm">País (ISO)<Input value={row.country} maxLength={2} onChange={event => patch(row.id, { country: event.target.value.toUpperCase() })} /></label>
      <label className="text-sm">Categoria<select aria-label={`Categoria do cenário ${index + 1}`} value={row.category} onChange={event => patch(row.id, { category: event.target.value })} className="h-9 w-full rounded-md border bg-background px-2">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Condição assumida<select aria-label={`Condição do cenário ${index + 1}`} value={row.pricingType} onChange={event => patch(row.id, { pricingType: event.target.value })} className="h-9 w-full rounded-md border bg-background px-2"><option value="REGULAR">Cobrança regular</option><option value="FREE_CUSTOMER_SERVICE">Atendimento gratuito elegível</option><option value="FREE_ENTRY_POINT">Entrada gratuita elegível</option></select></label>
      <label className="text-sm">Pessoas<Input type="number" min={1} max={1000000} value={row.people} onChange={event => patch(row.id, { people: Number(event.target.value) })} /></label>
      <label className="text-sm">Mensagens por pessoa<Input type="number" min={1} max={1000000} value={row.messagesEach} onChange={event => patch(row.id, { messagesEach: Number(event.target.value) })} /></label>
      <label className="text-sm">Volume anterior assumido<Input type="number" min={0} value={row.volumeBefore} onChange={event => patch(row.id, { volumeBefore: Number(event.target.value) })} /></label>
      {rows.length > 1 && <Button variant="ghost" onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}>Remover cenário</Button>}
    </fieldset>)}
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setRows(previous => [...previous, initialRow()])} disabled={rows.length >= 30 || busy}>Adicionar cenário</Button><Button onClick={simulate} disabled={busy || !at}>{busy ? "Calculando…" : "Calcular estimativa"}</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {current && <div className="space-y-2" aria-live="polite"><p className="text-lg font-semibold">Estimativa: {formatCost(current.total, current.currency)}</p>{current.rows.map((row, index) => <div key={index} className="border-b pb-2 text-sm"><p>{row.quantity} mensagens · {row.country} · {categoryLabels[row.category] ?? row.category}: {formatCost(row.amount, current.currency)}{row.amount === null && " — sem tarifa para toda a vigência/faixa"}</p>{row.segments.map(segment => <p key={segment.rate.id} className="text-xs text-muted-foreground">{segment.quantity} × {formatCost(segment.rate.unitRate, segment.rate.currency)} · <a className="underline" href={segment.rate.sourceUrl} target="_blank" rel="noreferrer">Fonte da tarifa</a></p>)}</div>)}<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{current.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul></div>}
  </section>;
};
