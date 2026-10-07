"use client";
import { useState } from "react";
import { RecipientImport } from "@/components/broadcasts/recipient-import";
import type { ImportedAudience } from "@/lib/import-types";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOfficialConnections } from "@/lib/queries/whatsapp-official";
import { useSendTemplates } from "@/lib/queries/inbox";
import { useOfficialCampaigns } from "@/lib/queries/whatsapp-campaigns";
import type { BroadcastFilters, BroadcastPreviewRow, Pipeline } from "@/lib/types";
import type { CampaignInput, CampaignPreview, OfficialCampaign, ParameterSource } from "@/lib/campaign-types";
import { BroadcastFiltersForm } from "@/app/(app)/deals/broadcast-filters";
import { BroadcastRecipients } from "@/app/(app)/deals/broadcast-recipients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplateFields, templateSupported, templateVariables, templateHeaderFormat, templateButtons } from "./template-fields";
import { CampaignProgress, campaignStatus } from "./campaign-progress";
import { formatCost, categoryLabels, costLabels } from "./cost-format";

type Creation = CampaignInput & { name: string; idempotencyKey: string; previewHash: string };
export const CampaignPanel = ({ pipeline }: { pipeline: Pipeline }) => {
  const { data: org } = useActiveOrganization(); const qc = useQueryClient();
  const connections = useOfficialConnections(); const history = useOfficialCampaigns(pipeline.id);
  const [selectedConnectionId, setConnectionId] = useState(""); const [templateId, setTemplateId] = useState(""); const [name, setName] = useState("");
  const connectionId = selectedConnectionId || connections.data?.find(value => value.status === "connected")?.id || "";
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [filters, setFilters] = useState<BroadcastFilters>({}); const [rows, setRows] = useState<BroadcastPreviewRow[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({}); const [snapshot, setSnapshot] = useState<CampaignPreview | null>(null);
  const [headerFile, setHeaderFile] = useState<File | null>(null);
  const [headerUploadId, setHeaderUploadId] = useState<string | null>(null);
  const [previewInput, setPreviewInput] = useState<CampaignInput | null>(null);
  const [sources, setSources] = useState<Record<string, ParameterSource | "">>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const [audienceSource, setAudienceSource] = useState<"crm" | "import">("crm");
  const [importedAudience, setImportedAudience] = useState<ImportedAudience | null>(null);
  const [pendingCreation, setPendingCreation] = useState<Creation | null>(null); const [error, setError] = useState<string | null>(null);
  const templates = useSendTemplates(connectionId || null); const template = templates.data?.find(value => value.id === templateId);
  const sync = useMutation({ mutationFn: async () => api.post(`/whatsapp/outbound/connections/${connectionId}/templates/sync`, {}), onSuccess: () => { setSnapshot(null); void qc.invalidateQueries({ queryKey: ["whatsapp-inbox", org?.id, "templates"] }); }, onError: error => setError((error as { message?: string }).message ?? "Não foi possível sincronizar templates") });
  const headerFormat = templateHeaderFormat(template);
  const headerAccept = headerFormat === "IMAGE" ? "image/jpeg,image/png" : headerFormat === "VIDEO" ? "video/mp4" : "application/pdf";
  const upload = useMutation({ mutationFn: async () => {
    if (!headerFile || !headerFormat || !connectionId || !headerAccept.split(",").includes(headerFile.type) || headerFile.size > (headerFormat === "IMAGE" ? 5 : 16) * 1024 * 1024) throw { message: "Escolha um arquivo compatível com o cabeçalho e dentro do limite" };
    return (await api.post<{ id: string }>(`/whatsapp/outbound/connections/${connectionId}/uploads`, headerFile, { params: { filename: headerFile.name }, headers: { "Content-Type": headerFile.type } })).data;
  }, onSuccess: result => { setHeaderUploadId(result.id); setSnapshot(null); setError(null); }, onError: error => { setHeaderUploadId(null); setSnapshot(null); setError((error as { message?: string }).message ?? "Não foi possível validar o arquivo do cabeçalho"); } });
  const available = connections.data?.filter(value => value.status === "connected") ?? [];
  const targets = useMutation({ mutationFn: async () => (await api.post<BroadcastPreviewRow[]>("/whatsapp/campaigns/targets", { pipelineId: pipeline.id, filters })).data,
    onSuccess: result => { setRows(result); setSelected([]); setSnapshot(null); }, onError: error => setError((error as { message?: string }).message ?? "Não foi possível buscar os negócios") });
  const input: CampaignInput = { connectionId, templateId, pipelineId: pipeline.id, filters, dealIds: audienceSource === "import" ? [] : selected, ...(audienceSource === "import" && importedAudience ? { importedAudience } : {}), parameters: { header: {}, body: {} }, ...(headerFormat && headerUploadId ? { headerUploadId } : {}) };
  for (const variable of templateVariables(template)) {
    const source = sources[variable.key];
    if (source) { input.parameterSources ??= { header: {}, body: {} }; input.parameterSources[variable.part][variable.name] = source; }
    else input.parameters[variable.part][variable.name] = values[variable.key] ?? "";
  }
  for (const button of templateButtons(template)) { input.parameters.buttons ??= {}; input.parameters.buttons[button.index] = values[button.key] ?? ""; }
  const preview = useMutation({ mutationFn: async () => {
    const request = structuredClone(input);
    const result = (await api.post<CampaignPreview>("/whatsapp/campaigns/preview", request)).data;
    return { result, request };
  }, onSuccess: ({ result, request }) => { setSnapshot(result); setPreviewInput(request); setError(null); }, onError: error => { setSnapshot(null); setError((error as { message?: string }).message ?? "Não foi possível calcular o preview"); } });
  const create = useMutation({ mutationFn: async (request: Creation) => (await api.post<OfficialCampaign>("/whatsapp/campaigns", request)).data,
    onSuccess: result => { setViewing(result.id); setPendingCreation(null); setSnapshot(null); setError(null); void qc.invalidateQueries({ queryKey: ["whatsapp-campaigns", org?.id] }); },
    onError: error => { const failure = error as { code?: string; message?: string }; if (["CAMPAIGN_CHANGED", "CAMPAIGN_NO_RECIPIENTS"].includes(failure.code ?? "")) { setPendingCreation(null); setSnapshot(null); } setError(failure.message ?? "Não foi possível confirmar o rascunho. Consulte a mesma solicitação antes de criar outro"); } });
  const busy = targets.isPending || preview.isPending || create.isPending || upload.isPending || sync.isPending; const locked = !!pendingCreation;
  const save = () => {
    if (!snapshot || !previewInput) return;
    const request = pendingCreation ?? { ...structuredClone(previewInput), name: name.trim(), previewHash: snapshot.previewHash, idempotencyKey: crypto.randomUUID() };
    setPendingCreation(request); create.mutate(request);
  };
  if (viewing) return <div className="min-h-0 flex-1 overflow-y-auto"><Button variant="ghost" onClick={() => setViewing(null)}>Voltar às campanhas oficiais</Button><CampaignProgress key={viewing} id={viewing} /></div>;
  return <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto pr-1">
    <p className="text-sm text-muted-foreground">Uma mensagem por pessoa, com template aprovado. Revise o público e o custo antes de iniciar. O disparo continuará no servidor com o app fechado.</p>
    {connections.isLoading && <p role="status">Carregando números oficiais…</p>}
    {connections.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as conexões. <Button variant="outline" onClick={() => connections.refetch()}>Tentar novamente</Button></p>}
    {!connections.isLoading && !available.length && <p className="text-sm">Nenhum número oficial conectado. <Link href="/integracoes/whatsapp" className="text-primary underline">Conectar WhatsApp</Link></p>}
    <fieldset disabled={busy || locked} className="min-w-0 space-y-3">
      <label className="block text-sm">Nome da campanha<Input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
      <label className="block text-sm">Número oficial<select aria-label="Número oficial" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={connectionId} onChange={event => { setConnectionId(event.target.value); setTemplateId(""); setValues({}); setSources({}); setHeaderFile(null); setHeaderUploadId(null); setSnapshot(null); }}><option value="">Selecione o número</option>{available.map(value => <option key={value.id} value={value.id}>{value.label} · {value.displayPhoneNumber ?? "Número oficial"}</option>)}</select></label>
      <label className="block text-sm">Origem dos destinatários<select aria-label="Origem dos destinatários oficiais" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={audienceSource} onChange={event => { setAudienceSource(event.target.value as "crm" | "import"); setImportedAudience(null); setSelected([]); setSources({}); setSnapshot(null); setPreviewInput(null); }}><option value="crm">Negócios do CRM</option><option value="import">Importar arquivo</option></select></label>
      {audienceSource === "import" ? <RecipientImport onChange={value => { setImportedAudience(value); setSnapshot(null); setPreviewInput(null); }} /> : <>
      <BroadcastFiltersForm pipeline={pipeline} filters={filters} onChange={value => { setFilters(value); setRows([]); setSelected([]); setSnapshot(null); }} />
      <Button variant="outline" onClick={() => { setError(null); targets.mutate(); }}>Buscar negócios</Button>
      {targets.isSuccess && <div className="flex h-80 flex-col"><BroadcastRecipients rows={rows} stages={pipeline.stages} selected={selected} onChange={value => { setSelected(value.slice(0, 200)); setSnapshot(null); }} /></div>}
      <p className="text-xs text-muted-foreground">{"Selecione até 200 negócios. A identidade oficial é conferida no preview; negócios da mesma pessoa são deduplicados."}</p>
      </>}
      <label className="block text-sm">Template<select aria-label="Template" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={templateId} onChange={event => { setTemplateId(event.target.value); setValues({}); setSources({}); setHeaderFile(null); setHeaderUploadId(null); setSnapshot(null); }}><option value="">Selecione um template aprovado</option>{templates.data?.filter(templateSupported).map(value => <option key={value.id} value={value.id}>{value.name} · {value.language} · {categoryLabels[value.category] ?? "Categoria indisponível"}</option>)}</select></label>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={!connectionId || sync.isPending} onClick={() => sync.mutate()}>{sync.isPending ? "Sincronizando…" : "Sincronizar templates"}</Button><Link href="/integracoes/whatsapp?tab=templates" className="text-sm text-primary underline">Gerenciar templates</Link></div>
      {templates.isLoading && <p role="status">Carregando templates…</p>}
      {templates.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os templates.</p>}
      {connectionId && templates.isSuccess && !templates.data?.some(templateSupported) && <p className="text-sm text-muted-foreground">Nenhum template aprovado e compatível disponível nesta conta. Modelos em análise só poderão ser enviados após aprovação. Sincronize para atualizar o status.</p>}
      {template && <><TemplateFields nameOnly={audienceSource === "import"} template={template} values={values} sources={sources} disabled={busy || locked} onSourceChange={(key, value) => { setSources(previous => ({ ...previous, [key]: value })); setSnapshot(null); }} onChange={(key, value) => { setValues(previous => ({ ...previous, [key]: value })); setSnapshot(null); }} /><p className="text-xs text-muted-foreground">{"Textos fixos valem para todas as pessoas. Nome e nome completo também podem vir do arquivo. Os demais campos precisam de negócios do CRM; dados ausentes impedem o envio."}</p></>}
      {headerFormat && <div className="space-y-2"><label className="block text-sm">Arquivo do cabeçalho<Input aria-label="Arquivo do cabeçalho da campanha" type="file" accept={headerAccept} onChange={event => { setHeaderFile(event.target.files?.[0] ?? null); setHeaderUploadId(null); setSnapshot(null); }} /></label><p className="text-xs text-muted-foreground">{headerFormat === "IMAGE" ? "JPEG/PNG até 5 MiB." : headerFormat === "VIDEO" ? "MP4 até 16 MiB." : "PDF até 16 MiB."} O mesmo arquivo será enviado a todas as pessoas.</p><Button variant="outline" disabled={!headerFile || !connectionId || !!headerUploadId} onClick={() => upload.mutate()}>{upload.isPending ? "Validando arquivo…" : headerUploadId ? "Arquivo validado" : "Enviar e validar arquivo"}</Button></div>}
      <Button disabled={!connectionId || !template || (audienceSource === "import" ? !importedAudience : !selected.length) || (!!headerFormat && !headerUploadId) || templateButtons(template).some(button => !/^[A-Za-z0-9._~-]{1,256}$/.test(values[button.key] ?? "")) || templateVariables(template).some(variable => !sources[variable.key] && !values[variable.key]?.trim())} onClick={() => preview.mutate()}>Revisar destinatários e custos</Button>
    </fieldset>
    {snapshot && <div className="space-y-2 border-t pt-3"><p className="font-medium">{snapshot.eligible} {snapshot.eligible === 1 ? "elegível" : "elegíveis"}{" · "}{snapshot.excluded} {snapshot.excluded === 1 ? "excluído" : "excluídos"}</p><p className="text-sm">Previsão: {formatCost(snapshot.estimate.amount, snapshot.estimate.currency)} · 1 mensagem por pessoa</p><p className="text-xs text-muted-foreground">{snapshot.estimate.assumption}</p>
      {snapshot.headerMedia && <p className="text-sm">Cabeçalho: {snapshot.headerMedia.filename} · {(snapshot.headerMedia.size / 1024).toFixed(1)} KiB · {snapshot.headerMedia.mime}</p>}
      <ul className="space-y-1 text-xs">{snapshot.rows.map(row => <li key={row.dealId} className="break-words">{row.clientName}: {row.exclusion ?? (row.cost.amount === null ? costLabels[row.cost.state] ?? "Custo indisponível" : formatCost(row.cost.amount, row.cost.currency))}{!row.exclusion && <span>{" · "}{row.cost.country ?? "Mercado desconhecido"}{" · "}{categoryLabels[row.cost.category] ?? "Categoria desconhecida"}{row.cost.rate && <a href={row.cost.rate.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 underline">Fonte da tarifa</a>}</span>}{row.text && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{row.text}</p>}</li>)}</ul>
      <Button disabled={busy || !name.trim() || !snapshot.eligible} onClick={save}>{locked ? "Consultar o mesmo rascunho" : "Criar rascunho"}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="space-y-3 border-t pt-5"><p className="font-medium">Histórico oficial neste funil</p><div className="flex flex-wrap gap-2"><Input className="max-w-sm" aria-label="Buscar campanha oficial" placeholder="Buscar pelo nome" value={historySearch} onChange={event => setHistorySearch(event.target.value)} /><select aria-label="Status da campanha oficial" className="h-9 rounded-md border bg-background px-2 text-sm" value={historyStatus} onChange={event => setHistoryStatus(event.target.value)}><option value="">Todos os status</option>{["draft", "running", "paused", "needs_review", "done", "canceled"].map(status => <option key={status} value={status}>{campaignStatus[status]}</option>)}</select></div>{history.isLoading && <p role="status">Carregando campanhas…</p>}{history.isError && <p role="alert">Não foi possível carregar as campanhas. <Button variant="outline" onClick={() => history.refetch()}>Tentar novamente</Button></p>}{history.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma campanha oficial criada.</p>}{history.data?.filter(campaign => (!historyStatus || campaign.status === historyStatus) && campaign.name.toLowerCase().includes(historySearch.toLowerCase())).map(campaign => <Button key={campaign.id} variant="outline" className="h-auto w-full justify-between whitespace-normal text-left" onClick={() => setViewing(campaign.id)}><span>{campaign.name} · {new Date(campaign.createdAt).toLocaleString("pt-BR")}</span><span>{campaignStatus[campaign.status] ?? "Indisponível"}</span></Button>)}</div>
  </div>;
};
