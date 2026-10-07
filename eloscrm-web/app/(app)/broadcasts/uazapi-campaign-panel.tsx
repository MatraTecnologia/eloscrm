"use client";

import { useState } from "react";
import { RecipientImport } from "@/components/broadcasts/recipient-import";
import type { ImportedAudience } from "@/lib/import-types";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useWhatsappInstance } from "@/lib/queries/whatsapp";
import { useBroadcasts, useCreateBroadcast, usePreviewBroadcast } from "@/lib/queries/broadcasts";
import { renderTemplate, templateVarsOf } from "@/lib/broadcast-template";
import type { BroadcastFilters, BroadcastPreviewRow, Pipeline } from "@/lib/types";
import type { ApiError } from "@/lib/api";
import { BroadcastFiltersForm } from "../deals/broadcast-filters";
import { BroadcastRecipients } from "../deals/broadcast-recipients";
import { BroadcastMessage } from "../deals/broadcast-message";
import { BroadcastProgress, BroadcastStatusBadge } from "../deals/broadcast-progress";

export const UazapiCampaignPanel = ({ pipeline }: { pipeline: Pipeline }) => {
  const instance = useWhatsappInstance();
  const history = useBroadcasts(pipeline.id);
  const preview = usePreviewBroadcast();
  const create = useCreateBroadcast();
  const [audienceSource, setAudienceSource] = useState<"crm" | "import">("crm");
  const [importedCount, setImportedCount] = useState(0);
  const [importedAudience, setImportedAudience] = useState<ImportedAudience | null>(null);
  const [filters, setFilters] = useState<BroadcastFilters>({});
  const [rows, setRows] = useState<BroadcastPreviewRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const connected = instance.data?.status === "connected";
  const selectedRows = rows.filter(row => selected.includes(row.dealId));
  const sample = selectedRows.find(row => row.dealId === sampleId) ?? selectedRows[0] ?? null;
  const recipientCount = audienceSource === "import" ? importedCount : selectedRows.length;
  const importedSample: BroadcastPreviewRow | null = importedAudience?.recipients[0] ? { dealId: "import", title: "Lista importada", value: null, stageId: "", propertyTitle: null, ownerName: null, tags: [], client: { id: "", name: importedAudience.recipients[0].name, phone: importedAudience.recipients[0].phone, temperature: "FRIO" }, sendable: true, exclusion: null } : null;
  const invalid = audienceSource === "import"
    ? /\{\{|\}\}/.test(text.replace(new RegExp("\\{\\{\\s*(nome|nome_completo)\\s*\\}\\}", "gi"), "")) || (!!importedAudience && importedAudience.recipients.some(row => !row.name && new RegExp("\\{\\{\\s*nome(?:_completo)?\\s*\\}\\}", "i").test(text)))
    : selectedRows.some(row => { const rendered = renderTemplate(text, templateVarsOf(row)); return rendered.length > 2000 || /\{\{|\}\}/.test(rendered); });
  const busy = preview.isPending || create.isPending;
  const load = async () => {
    try { const result = await preview.mutateAsync({ pipelineId: pipeline.id, filters }); setRows(result); setSelected([]); }
    catch (error) { toast.error((error as ApiError).message ?? "Não foi possível buscar os destinatários"); }
  };
  const send = async () => {
    const idempotencyKey = pendingKey ?? crypto.randomUUID();
    setPendingKey(idempotencyKey);
    try {
      const result = await create.mutateAsync({ pipelineId: pipeline.id, filters, dealIds: audienceSource === "import" ? [] : selected, ...(audienceSource === "import" && importedAudience ? { importedAudience } : {}), text: text.trim(), idempotencyKey });
      setPendingKey(null); setConfirming(false); setViewing(result.id);
      toast.success("Disparo criado. Acompanhe os envios abaixo.");
    } catch (error) {
      const failure = error as ApiError;
      if (["VALIDATION_ERROR", "INSTANCE_NOT_CONNECTED", "NOT_FOUND", "BROADCAST_REDIS_REQUIRED", "BROADCAST_MESSAGE_INVALID", "NO_RECIPIENTS", "BROADCAST_IDEMPOTENCY"].includes(failure.code)) setPendingKey(null);
      toast.error(failure.message ?? "Não foi possível confirmar o disparo. Consulte o histórico antes de tentar novamente.");
    }
  };
  if (viewing) return <div className="space-y-4"><Button variant="ghost" onClick={() => setViewing(null)}>Voltar aos disparos uazapi</Button><div className="flex min-h-[400px] flex-col"><BroadcastProgress broadcastId={viewing} /></div></div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Disparo pela uazapi</h2><p className="text-sm text-muted-foreground">Número: {instance.data?.ownerJid?.split("@")[0] ?? instance.data?.name ?? "Não configurado"} · {connected ? "Conectado" : "Desconectado"}</p></div><Link href="/integracoes/whatsapp?tab=uazapi" className="text-sm text-primary underline">Gerenciar conexão</Link></div>
    {instance.isError && <p role="alert" className="text-sm text-destructive">Não foi possível consultar a conexão uazapi.</p>}
    {!connected && <p className="text-sm text-muted-foreground">{"Você pode preparar a mensagem; conecte a uazapi para iniciar os envios."}</p>}
    <fieldset disabled={busy || !!pendingKey} className="min-w-0 space-y-5">
      <section className="space-y-3"><h3 className="font-medium">Público</h3><label className="block text-sm">Origem dos destinatários<select aria-label="Origem dos destinatários uazapi" value={audienceSource} onChange={event => { setAudienceSource(event.target.value as "crm" | "import"); setImportedAudience(null); setImportedCount(0); setSelected([]); }} className="mt-1 w-full rounded-md border bg-background p-2"><option value="crm">Negócios do CRM</option><option value="import">Importar arquivo</option></select></label>{audienceSource === "import" ? <RecipientImport onChange={(value, count) => { setImportedAudience(value); setImportedCount(count); }} /> : <><BroadcastFiltersForm pipeline={pipeline} filters={filters} onChange={value => { setFilters(value); setRows([]); setSelected([]); }} /><Button variant="outline" onClick={load}>{preview.isPending ? "Buscando…" : "Buscar destinatários"}</Button>
        {preview.isSuccess && <div className="flex h-80 flex-col"><BroadcastRecipients rows={rows} stages={pipeline.stages} selected={selected} onChange={setSelected} /></div>}
        <p className="text-xs text-muted-foreground">Até 200 negócios por disparo. Telefones repetidos recebem uma única mensagem.</p>
        </>}
      </section>
      <section className="space-y-3 border-t pt-5">
        <h3 className="font-medium">Mensagem</h3>
        {!!selectedRows.length && <label className="block space-y-1 text-sm">Conferir personalização<select aria-label="Destinatário da prévia uazapi" value={sample?.dealId ?? ""} onChange={event => setSampleId(event.target.value)} className="block h-9 w-full rounded-md border bg-background px-2">{selectedRows.map(row => <option key={row.dealId} value={row.dealId}>{row.client.name} · {row.title}</option>)}</select></label>}
        <BroadcastMessage nameOnly={audienceSource === "import"} text={text} onChange={setText} sample={audienceSource === "import" ? importedSample : sample} />
        <p className="text-xs text-muted-foreground">{text.length}{"/2000 caracteres. A uazapi não gera cobrança de templates da Meta; os custos do provedor dependem do seu contrato."}</p>
        {invalid && <p role="alert" className="text-sm text-destructive">Há variáveis desconhecidas ou mensagens personalizadas com mais de 2000 caracteres. Corrija antes de enviar.</p>}
      </section>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm">{recipientCount} destinatários selecionados · mensagens enviadas não podem ser desfeitas</p><Button disabled={busy || !connected || !recipientCount || (audienceSource === "import" && !importedAudience) || !text.trim() || text.length > 2000 || invalid} onClick={() => setConfirming(true)}>{pendingKey ? "Consultar o mesmo disparo" : "Revisar e disparar"}</Button></div>
    <section className="space-y-3 border-t pt-5"><h3 className="font-medium">Histórico uazapi neste funil</h3><div className="flex flex-wrap gap-2"><Input className="max-w-sm" aria-label="Buscar disparos uazapi" placeholder="Buscar pela mensagem" value={historySearch} onChange={event => setHistorySearch(event.target.value)} /><select aria-label="Status dos disparos uazapi" value={historyStatus} onChange={event => setHistoryStatus(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="">Todos os status</option><option value="RUNNING">Enviando</option><option value="PAUSED">Pausado</option><option value="DONE">Concluído</option><option value="CANCELED">Cancelado</option></select></div>{history.isLoading && <p role="status">Carregando disparos…</p>}{history.isError && <p role="alert">Não foi possível carregar o histórico. <Button variant="outline" onClick={() => history.refetch()}>Tentar novamente</Button></p>}{history.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum disparo neste funil.</p>}{history.data?.filter(item => (!historyStatus || item.status === historyStatus) && item.text.toLowerCase().includes(historySearch.toLowerCase())).map(item => <button key={item.id} onClick={() => setViewing(item.id)} className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted"><div className="min-w-0"><p className="truncate text-sm">{item.text}</p><p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("pt-BR")} · {item.sent}/{item.total} enviadas · {item.failed} falhas</p></div><BroadcastStatusBadge status={item.status} /></button>)}</section>
    <AlertDialog open={confirming} onOpenChange={open => { if (!create.isPending) setConfirming(open); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar disparo pela uazapi?</AlertDialogTitle>
          <AlertDialogDescription>{`Serão processados ${recipientCount} destinatários pelo número ${instance.data?.ownerJid?.split("@")[0] ?? instance.data?.name}. Telefones repetidos serão excluídos. Os envios ocorrem com intervalo; você poderá cancelar o restante pelo acompanhamento.`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={create.isPending}>Voltar</AlertDialogCancel>
          <Button disabled={create.isPending} onClick={send}>{create.isPending ? "Confirmando…" : pendingKey ? "Consultar o mesmo disparo" : "Confirmar envio"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
};
