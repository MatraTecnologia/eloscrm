"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import type { CostScopes } from "@/lib/cost-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const CostRecipientMarket = ({ connectionId, contacts, onSaved }: { connectionId: string; contacts: CostScopes["contacts"]; onSaved: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const values = new FormData(event.currentTarget); setBusy(true); setError(null);
    try {
      await api.post("/whatsapp/costs/recipient-country", { connectionId, identityId: values.get("identityId"), country: String(values.get("country")).toUpperCase() });
      onSaved(); toast.success("Mercado declarado salvo. Use reapuração explícita para revisar entregas anteriores.");
    } catch (failure) { setError((failure as ApiError).message); }
    finally { setBusy(false); }
  };
  return <details className="rounded-md border p-3"><summary className="cursor-pointer font-medium">Declarar mercado do destinatário</summary><form onSubmit={save} className="mt-3 space-y-3">
    <p className="text-sm text-muted-foreground">{"Declare o país de cobrança quando conhecido. BSUID não revela país; sem mercado conhecido, a estimativa permanece indisponível."}</p>
    <label className="block text-sm">Identidade do contato<select name="identityId" aria-label="Identidade para mercado declarado" className="h-9 w-full rounded-md border bg-background px-2" required><option value="">Selecione</option>{contacts.flatMap(contact => contact.identities.map((identity, index) => <option key={identity.id} value={identity.id}>{contact.label} · identidade {index + 1} · {identity.recipientCountry ?? "País não declarado"}</option>))}</select></label>
    <label className="block text-sm">País (ISO)<Input name="country" maxLength={2} minLength={2} required /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || !contacts.length}>{busy ? "Salvando…" : "Salvar mercado declarado"}</Button>
  </form></details>;
};
