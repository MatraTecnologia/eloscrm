"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { exportCampaignCsv } from "@/lib/campaign-export";
import { describeCampaignError } from "./campaign-error-labels";

export type RecipientReportRow = {
  id: string; name: string; destination: string | null; status: string; label: string;
  error: string | null; code: string | null; stage: string | null; attempts: number;
  startedAt: string | null; completedAt: string | null; text?: string | null; cost?: string | null; clientId?: string | null;
};
const stageLabels: Record<string, string> = { selection: "Seleção", validation: "Validação", connection: "Conexão", preparation: "Preparação", provider: "Provedor", delivery: "Entrega", recovery: "Recuperação" };
const failed = (row: RecipientReportRow) => ["FAILED", "UNKNOWN", "failed", "unknown", "delivery_failed"].includes(row.status);

export const CampaignRecipientReport = ({ rows, campaignId }: { rows: RecipientReportRow[]; campaignId: string }) => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const failures = rows.filter(failed);
  // Excluídos na prévia aparecem para consulta, mas não são destinos processados.
  const processed = rows.filter(row => row.status !== "excluded").length;
  const visible = rows.filter(row => (!status || (status === "errors" ? failed(row) : row.status === status)) && `${row.name} ${row.destination ?? ""} ${row.code ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const statuses = [...new Map(rows.map(row => [row.status, row.label])).entries()];
  // Resumo por motivo: com dezenas de falhas, o que importa é quantas são de cada tipo.
  const reasons = [...failures.reduce((groups, row) => { const label = describeCampaignError(row.code)?.label ?? row.error ?? "Motivo não informado"; return groups.set(label, (groups.get(label) ?? 0) + 1); }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const exportResults = () => exportCampaignCsv(`campaign-${campaignId}.csv`, ["Destinatário", "Destino", "Status", "Erro", "Motivo", "Orientação", "Código", "Etapa", "Tentativas", "Início", "Conclusão", "Custo"], rows.map(row => { const hint = describeCampaignError(row.code); return [row.name, row.destination, row.label, row.error, hint?.label ?? null, hint?.action ?? null, row.code, row.stage, row.attempts, row.startedAt, row.completedAt, row.cost]; }));
  return <section className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Resultado por destinatário</h3><Button variant="outline" size="sm" onClick={exportResults} disabled={!rows.length}><Download className="size-4" />Exportar CSV</Button></div>
    {!!failures.length && <p role="status" className="text-sm text-destructive">{failures.length === processed ? "Todos os destinos apresentam falha ou resultado incerto." : `${failures.length} de ${processed} destinos apresentam falha ou resultado incerto. Os outros destinos são processados separadamente.`}</p>}
    {reasons.length > 1 && <ul className="space-y-0.5 text-sm">{reasons.map(([label, count]) => <li key={label}><span className="tabular-nums">{count}</span>{" · "}{label}</li>)}</ul>}
    <div className="flex flex-wrap gap-2"><Input className="max-w-sm" aria-label="Buscar resultado do disparo" placeholder="Buscar pessoa, destino ou código" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="Filtrar resultado do disparo" value={status} onChange={event => setStatus(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">Todos os resultados</option><option value="errors">Falhas e resultados incertos</option>{statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <p className="text-xs text-muted-foreground">{visible.length} de {rows.length} destinatários</p>
    {!visible.length && <p className="text-sm text-muted-foreground">Nenhum resultado corresponde aos filtros.</p>}
    <div className="space-y-2">{visible.map(row => <details key={row.id} className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm"><span className="font-medium">{row.name}</span><span className={failed(row) ? "ml-2 text-destructive" : "ml-2 text-muted-foreground"}>{row.label}</span>{row.destination && <span className="ml-2 text-xs text-muted-foreground">{row.destination}</span>}</summary>
      <div className="mt-3 space-y-2 text-sm">
        {row.error && <p className="break-words text-destructive">{row.error}</p>}
        {describeCampaignError(row.code) && <p className="break-words"><span className="font-medium">{describeCampaignError(row.code)!.label}.</span>{" "}{describeCampaignError(row.code)!.action}</p>}
        {row.clientId && <Link href={`/clients/${row.clientId}`} className="text-xs text-primary underline">Abrir ficha do lead</Link>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"><dt>Referência</dt><dd className="break-all">{row.id}</dd><dt>Tentativas</dt><dd>{row.attempts}</dd>{row.code && <><dt>Código</dt><dd>{row.code}</dd></>}{row.stage && <><dt>Etapa</dt><dd>{stageLabels[row.stage] ?? row.stage}</dd></>}{row.startedAt && <><dt>Início</dt><dd>{new Date(row.startedAt).toLocaleString("pt-BR")}</dd></>}{row.completedAt && <><dt>Conclusão</dt><dd>{new Date(row.completedAt).toLocaleString("pt-BR")}</dd></>}{row.cost && <><dt>Custo apurado</dt><dd>{row.cost}</dd></>}</dl>
        {row.status === "UNKNOWN" || row.status === "unknown" ? <p className="text-xs text-muted-foreground">Confira o WhatsApp antes de repetir: o provedor pode ter enviado a mensagem sem retornar a confirmação.</p> : null}
        {row.text && <p className="whitespace-pre-wrap break-words border-t pt-2">{row.text}</p>}
      </div>
    </details>)}</div>
  </section>;
};
