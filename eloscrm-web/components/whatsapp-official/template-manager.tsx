"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import { useOfficialConnections } from "@/lib/queries/whatsapp-official";
import { useSendTemplates } from "@/lib/queries/inbox";
import { useActiveOrganization } from "@/lib/auth-client";
import type { OfficialTemplate } from "@/lib/messaging-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { TemplateEditor, type TemplateDraft } from "./template-editor";

const statusLabels: Record<string, string> = { APPROVED: "Aprovado", PENDING: "Em análise", REJECTED: "Rejeitado", PAUSED: "Pausado", DISABLED: "Desativado", PENDING_DELETION: "Exclusão pendente", ARCHIVED: "Arquivado", FLAGGED: "Sinalizado", IN_APPEAL: "Em recurso", LIMIT_EXCEEDED: "Limite excedido", LOCKED: "Bloqueado" };
const rejectionLabels: Record<string, string> = { INVALID_FORMAT: "Formato inválido", INCORRECT_CATEGORY: "Categoria incorreta", TAG_CONTENT_MISMATCH: "O conteúdo não corresponde à categoria", ABUSIVE_CONTENT: "Conteúdo que viola as políticas", PROMOTIONAL: "Conteúdo promocional não permitido nesta categoria", SCAM: "Suspeita de fraude", CATEGORY_NOT_AVAILABLE: "Categoria indisponível" };
const categoryLabels: Record<string, string> = { UTILITY: "Utilidade", MARKETING: "Marketing", AUTHENTICATION: "Autenticação" };
export const TemplateManager = () => {
  const connections = useOfficialConnections();
  const { data: org } = useActiveOrganization();
  const qc = useQueryClient();
  const [connectionId, setConnectionId] = useState("");
  const connection = connections.data?.find(item => item.id === connectionId) ?? connections.data?.find(item => item.status === "connected") ?? connections.data?.[0];
  const templates = useSendTemplates(connection?.id ?? null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OfficialTemplate | null>(null);
  const visible = (templates.data ?? []).filter(item => item.status !== "MISSING" && (!status || item.status === status) && (!category || item.category === category) && item.name.toLowerCase().includes(search.toLowerCase()));
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const connected = connection?.status === "connected";
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["whatsapp-inbox", org?.id, "templates"] }); };
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    try { await action(); await refresh(); toast.success(message); }
    catch (error) { toast.error((error as ApiError).message ?? "Não foi possível concluir a operação"); }
    finally { setBusy(false); }
  };
  const create = (draft: TemplateDraft) => run(async () => { await api.post(`/whatsapp/outbound/connections/${connection!.id}/templates`, draft); setCreating(false); }, "Template enviado para aprovação");
  return <div className="space-y-4 py-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Templates de mensagens</h2><p className="text-sm text-muted-foreground">Modelos da conta WhatsApp para iniciar conversas e responder após a janela de 24 horas.</p></div><div className="flex gap-2"><Button variant="outline" disabled={!connected || busy} onClick={() => run(() => api.post(`/whatsapp/outbound/connections/${connection!.id}/templates/sync`, {}), "Templates sincronizados")}><RefreshCw className="size-4" />Sincronizar</Button><Button disabled={!connected || busy} onClick={() => setCreating(true)}><Plus className="size-4" />Novo template</Button></div></div>
    {connections.isError && <p role="alert">Não foi possível consultar as conexões.</p>}
    {connections.isLoading && <p role="status">Carregando contas…</p>}
    {!connections.isLoading && !connections.isError && !connection && <p className="text-sm text-muted-foreground">Conecte o WhatsApp oficial para gerenciar seus templates.</p>}
    {connection && <><label className="block max-w-lg space-y-1 text-sm">Conta WhatsApp<select aria-label="Conta dos templates" value={connection.id} className="h-9 w-full rounded-md border bg-background px-2" disabled={busy} onChange={event => { setConnectionId(event.target.value); setCreating(false); setSelectedId(null); }}>{connections.data?.map(item => <option key={item.id} value={item.id}>{item.label} · {item.displayPhoneNumber ?? "Sem número"}</option>)}</select></label>
      {!connected && <p role="alert" className="text-sm text-destructive">Reconecte o número para sincronizar ou alterar templates.</p>}
      {creating && <TemplateEditor key={connection.id} busy={busy} onSave={create} onCancel={() => setCreating(false)} />}
      <div className="flex flex-wrap gap-2"><Input className="max-w-sm" aria-label="Buscar template" placeholder="Buscar pelo nome" value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="Status do template" className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="Categoria do template" className="h-9 rounded-md border bg-background px-2 text-sm" value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas as categorias</option>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      {templates.isLoading && <p role="status">Carregando templates…</p>}
      {templates.isError && <p role="alert">Não foi possível consultar os templates. <Button variant="outline" onClick={() => templates.refetch()}>Tentar novamente</Button></p>}
      {!templates.isLoading && !templates.isError && !visible.length && <p className="py-8 text-center text-sm text-muted-foreground">{search || status || category ? "Nenhum template corresponde aos filtros. Ajuste a busca, o status ou a categoria." : "Nenhum template encontrado. Sincronize a conta ou crie um novo modelo."}</p>}
      {selected?.status === "PENDING" && <p className="text-sm text-muted-foreground">A Meta costuma concluir a análise em até 24 horas. O status recebido pelo webhook aparece automaticamente nesta tela.</p>}
      {selected?.status === "REJECTED" && <div role="status" className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm"><p className="font-medium text-destructive">Motivo da rejeição: {selected.rejectionReason ? rejectionLabels[selected.rejectionReason] ?? selected.rejectionReason : "A Meta não informou o motivo."}</p>{selected.rejectionDetail && <p className="whitespace-pre-wrap break-words">{selected.rejectionDetail}</p>}{selected.rejectionRecommendation && <p className="whitespace-pre-wrap break-words"><span className="font-medium">Recomendação da Meta: </span>{selected.rejectionRecommendation}</p>}<p className="text-muted-foreground">Edite ou solicite revisão no gerenciador da Meta pelo link abaixo.</p></div>}
      {!!visible.length && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="p-3 font-medium">Template</th><th className="p-3 font-medium">Categoria</th><th className="p-3 font-medium">Status</th></tr></thead><tbody>{visible.map(item => <tr key={item.id} className={selected?.id === item.id ? "bg-muted" : ""}><td className="border-b p-3"><button className="text-left font-medium hover:underline" onClick={() => setSelectedId(item.id)}>{item.name}</button><p className="text-xs text-muted-foreground">{item.language}</p></td><td className="border-b p-3">{categoryLabels[item.category] ?? item.category}</td><td className="border-b p-3">{statusLabels[item.status] ?? item.status}</td></tr>)}</tbody></table></div>{selected && <aside className="space-y-3 rounded-lg border p-4"><h3 className="break-words font-medium">{selected.name}</h3><p className="text-xs text-muted-foreground">Atualizado em {new Date(selected.syncedAt).toLocaleString("pt-BR")}</p><div className="space-y-3 rounded-lg bg-muted p-3 text-sm">{selected.definition.components.map((component, index) => <div key={index}>{component.format && component.format !== "TEXT" && <p className="text-xs text-muted-foreground">Cabeçalho: {component.format}</p>}{component.text && <p className={`whitespace-pre-wrap break-words ${component.type === "HEADER" ? "font-semibold" : component.type === "FOOTER" ? "text-xs text-muted-foreground" : ""}`}>{component.text}</p>}{component.buttons?.map((button, index) => <p key={index} className="mt-2 border-t pt-2 text-xs">{button.text ?? button.type}</p>)}</div>)}</div><Button variant="outline" className="w-full text-destructive" disabled={busy || !connected || selected.status === "PENDING_DELETION"} onClick={() => setDeleting(selected)}><Trash2 className="size-4" />Excluir template</Button></aside>}</div>}
      <a className="inline-flex items-center gap-1 text-sm text-primary underline" href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />Gerenciar modelos com mídia, botões e edições na Meta</a>
    </>}
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir template?</AlertDialogTitle><AlertDialogDescription>O modelo {deleting?.name} ({deleting?.language}) será excluído da conta WhatsApp e ficará indisponível para novos envios por todos os números dessa conta.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => run(async () => { await api.delete(`/whatsapp/outbound/connections/${connection!.id}/templates/${deleting!.id}`); setDeleting(null); }, "Template excluído")}>{busy ? "Excluindo…" : "Excluir template"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
};
