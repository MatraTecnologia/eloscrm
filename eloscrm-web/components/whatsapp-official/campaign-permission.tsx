"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { CommunicationPermission } from "@/lib/campaign-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const CampaignPermission = ({ clientId, name, onSaved }: { clientId: string; name: string; onSaved: () => void }) => {
  const { data: org } = useActiveOrganization(); const [evidence, setEvidence] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["communication-permission", org?.id, clientId], enabled: !!org?.id, queryFn: async () => (await api.get<CommunicationPermission>(`/whatsapp/campaigns/permissions/${clientId}`)).data });
  const save = async (state: "allowed" | "suppressed") => {
    setBusy(true); setError(null);
    try { await api.post(`/whatsapp/campaigns/permissions/${clientId}`, { state, evidence: evidence.trim() }); await query.refetch(); onSaved(); }
    catch (error) { setError((error as { message?: string }).message ?? "Não foi possível registrar a permissão"); }
    finally { setBusy(false); }
  };
  return <details className="rounded-md border p-2 text-sm"><summary className="cursor-pointer">{name}: {query.data?.state === "allowed" ? "permissão registrada" : query.data?.state === "suppressed" ? "comunicação descadastrada" : "sem permissão registrada"}</summary>
    <div className="mt-2 space-y-2"><p className="text-xs text-muted-foreground">Registre a origem e a data da autorização ou do pedido de descadastro. O descadastro impede campanhas nos dois canais.</p>
      {query.data?.evidence && <p className="break-words text-xs">{query.data.evidence}</p>}
      <label className="block text-xs">Evidência<Input value={evidence} onChange={event => setEvidence(event.target.value)} maxLength={500} disabled={busy} /></label>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || evidence.trim().length < 3} onClick={() => void save("allowed")}>Registrar autorização</Button><Button size="sm" variant="outline" disabled={busy || evidence.trim().length < 3} onClick={() => void save("suppressed")}>Registrar descadastro</Button></div>
      {(error || query.isError) && <p role="alert" className="text-sm text-destructive">{error ?? "Não foi possível consultar a permissão"}</p>}
    </div></details>;
};
