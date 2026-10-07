"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categoryLabels } from "./cost-format";

export const CostRateForm = ({ connectionId, currency, onSaved }: { connectionId: string; currency: string | null; onSaved: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await api.post("/whatsapp/costs/rates", { connectionId, country: String(form.get("country")).toUpperCase(), category: form.get("category"), pricingType: form.get("pricingType"), unitRate: String(form.get("unitRate")).replace(",", "."), validFrom: `${form.get("validFrom")}T00:00:00.000Z`, validUntil: `${form.get("validUntil")}T00:00:00.000Z`, volumeFrom: Number(form.get("volumeFrom")), volumeUntil: form.get("volumeUntil") ? Number(form.get("volumeUntil")) : null, sourceUrl: form.get("sourceUrl") });
      toast.success("Tarifa cadastrada. Apurações anteriores foram preservadas."); onSaved();
    } catch (failure) { setError((failure as ApiError).message); }
    finally { setBusy(false); }
  };
  return <details className="rounded-md border p-3"><summary className="cursor-pointer font-medium">Cadastrar tarifa oficial</summary><form onSubmit={save} className="mt-3 space-y-3">
    <p className="text-sm text-muted-foreground">Copie a tarifa da fonte oficial na moeda da WABA ({currency ?? "não identificada"}). Vigência em UTC, fim exclusivo. Tarifas cadastradas são imutáveis e não podem sobrepor vigência/faixa.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">País (ISO)<Input name="country" defaultValue="BR" maxLength={2} required /></label>
      <label className="text-sm">Categoria<select name="category" aria-label="Categoria da tarifa" className="h-9 w-full rounded-md border bg-background px-2">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Condição<select name="pricingType" aria-label="Condição da tarifa" className="h-9 w-full rounded-md border bg-background px-2"><option value="REGULAR">Cobrança regular</option><option value="FREE_CUSTOMER_SERVICE">Atendimento gratuito elegível</option><option value="FREE_ENTRY_POINT">Entrada gratuita elegível</option></select></label>
      <label className="text-sm">Valor por mensagem<Input name="unitRate" inputMode="decimal" placeholder="0,0000000000" required /></label>
      <label className="text-sm">Início da vigência<Input name="validFrom" type="date" required /></label>
      <label className="text-sm">Fim exclusivo da vigência<Input name="validUntil" type="date" required /></label>
      <label className="text-sm">Volume inicial da faixa<Input name="volumeFrom" type="number" min={0} defaultValue={0} required /></label>
      <label className="text-sm">Limite exclusivo da faixa<Input name="volumeUntil" type="number" min={1} placeholder="Sem limite" /></label>
    </div>
    <label className="block text-sm">Página oficial da tarifa<Input name="sourceUrl" type="url" placeholder="https://developers.facebook.com/…" required /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !currency} type="submit">{busy ? "Salvando…" : "Salvar tarifa"}</Button>
  </form></details>;
};
