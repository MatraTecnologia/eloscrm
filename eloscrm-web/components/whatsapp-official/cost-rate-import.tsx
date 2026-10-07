"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const CostRateImport = ({ connectionId, currency, onSaved }: { connectionId: string; currency: string | null; onSaved: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError(null);
    try {
      let rows: unknown;
      try { rows = JSON.parse(String(values.get("rows"))); }
      catch { setError("Informe um JSON válido com a lista de tarifas."); return; }
      await api.post("/whatsapp/costs/rates/import", { connectionId, rows });
      form.reset(); onSaved(); toast.success("Tarifas importadas sem alterar apurações anteriores");
    } catch (failure) { setError((failure as ApiError).message); }
    finally { setBusy(false); }
  };
  return <details className="rounded-md border p-3"><summary className="cursor-pointer font-medium">Importar tarifas em JSON</summary><form onSubmit={save} className="mt-3 space-y-3">
    <p className="text-sm text-muted-foreground">Até 100 tarifas na moeda da WABA ({currency ?? "não identificada"}), com fonte oficial HTTPS. Se alguma linha falhar ou sobrepor vigência/faixa, nenhuma será importada.</p>
    <label className="block text-sm">Lista de tarifas<Textarea name="rows" className="mt-1 font-mono" rows={6} required aria-label="JSON de tarifas" /></label>
    <p className="text-xs text-muted-foreground">Cada objeto exige country, category, pricingType, unitRate (texto decimal), validFrom, validUntil (UTC) e sourceUrl. volumeFrom e volumeUntil são opcionais. Use os mesmos campos do cadastro individual, sem connectionId ou currency.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || !currency}>{busy ? "Importando…" : "Importar todas as tarifas"}</Button>
  </form></details>;
};
