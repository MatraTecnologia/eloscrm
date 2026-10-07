"use client";
import Link from "next/link";
import { Paperclip, Send, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, type ApiError } from "@/lib/api";
import { useSendTemplates, useInboxRefresh } from "@/lib/queries/inbox";
import type { InboxChannel, InboxMessage, OfficialCommand } from "@/lib/messaging-types";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useComposerDraft } from "./composer-draft";
import { useMembers } from "@/lib/queries/members";
import { ComposerCost } from "./composer-cost";
import { TemplateFields, templateSupported, templateVariables, templateHeaderFormat, templateButtons } from "./template-fields";

const acceptedMedia = "image/jpeg,image/png,audio/mpeg,audio/ogg,video/mp4,application/pdf";
export const OfficialComposer = ({ channel, replyTo, onCancelReply }: { channel: InboxChannel; replyTo: InboxMessage | null; onCancelReply: () => void }) => {
  const refresh = useInboxRefresh();
  const templates = useSendTemplates(channel.connectionId);
  const windowOpen = !!channel.serviceWindowExpiresAt && new Date(channel.serviceWindowExpiresAt) > new Date();
  const { data: session } = useSession();
  const { data: org } = useActiveOrganization();
  const { data: members } = useMembers();
  const role = members?.find(member => member.userId === session?.user.id)?.role;
  const { draft, entry } = useComposerDraft(`${session?.session.id}:${org?.id}:${channel.conversationId}`, windowOpen ? "text" : "template");
  const { mode, text, templateId, values, file, busy, uncertainRequest } = draft;
  const setMode = (mode: typeof draft.mode) => entry.update({ mode });
  const setText = (text: string) => entry.update({ text });
  const setTemplateId = (templateId: string) => entry.update({ templateId });
  const setValues = (values: Record<string, string>) => entry.update({ values });
  const setFile = (file: File | null) => entry.update({ file });
  const setBusy = (busy: boolean) => entry.update({ busy });
  const setUncertainRequest = (uncertainRequest: boolean) => entry.update({ uncertainRequest });
  const template = templates.data?.find(item => item.id === templateId);
  const identity = channel.identities.find(item => item.kind === "bsuid") ?? channel.identities.find(item => item.kind === "wa_id") ?? channel.identities[0];
  const connected = channel.status === "connected" && !channel.credentialExpired;
  const quotedAllowed = !replyTo || replyTo.conversationId === channel.conversationId;
  const variables = templateVariables(template);
  const headerFormat = templateHeaderFormat(template);
  const buttons = templateButtons(template);
  const headerAccept = headerFormat === "IMAGE" ? "image/jpeg,image/png" : headerFormat === "VIDEO" ? "video/mp4" : "application/pdf";
  const invalid = !connected || !identity || !quotedAllowed || (mode !== "template" && !windowOpen) || (mode === "text" && !text.trim()) || (mode === "media" && !file) || (mode === "template" && (!template || !templateSupported(template) || variables.some(variable => !values[variable.key]?.trim()) || buttons.some(button => !/^[A-Za-z0-9._~-]{1,256}$/.test(values[button.key] ?? "")) || (!!headerFormat && (!file || !headerAccept.split(",").includes(file.type)))));
  const submit = async () => {
    if (entry.isLocked() || (!entry.getPending() && invalid)) return;
    entry.setLocked(true); setBusy(true);
    try {
      if (!entry.getPending()) {
        const common = { idempotencyKey: crypto.randomUUID(), identityId: identity!.id, ...(replyTo ? { quotedMessageId: replyTo.id } : {}) };
        if (mode === "text") entry.setPending({ ...common, type: "text", text: text.trim() });
        if (mode === "template") {
          const parameters = { header: {} as Record<string, string>, body: {} as Record<string, string>, buttons: {} as Record<string, string> };
          for (const variable of variables) parameters[variable.part][variable.name] = values[variable.key]!;
          for (const button of buttons) parameters.buttons[button.index] = values[button.key]!;
          let headerUploadId: string | undefined;
          if (headerFormat && file) {
            const limit = headerFormat === "IMAGE" ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
            if (file.size > limit || !headerAccept.split(",").includes(file.type)) throw { code: "MEDIA", message: "Arquivo incompatível com o cabeçalho ou acima do limite" };
            const upload = await api.post<{ id: string }>(`/whatsapp/outbound/connections/${channel.connectionId}/uploads`, file, { params: { filename: file.name }, headers: { "Content-Type": file.type } });
            headerUploadId = upload.data.id;
          }
          entry.setPending({ ...common, type: "template", templateId, parameters, ...(headerUploadId ? { headerUploadId } : {}) });
        }
        if (mode === "media" && file) {
          const limit = file.type.startsWith("image/") ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
          if (file.size > limit || !acceptedMedia.split(",").includes(file.type)) throw { code: "MEDIA", message: "Arquivo acima do limite ou de tipo não suportado" };
          const upload = await api.post<{ id: string }>(`/whatsapp/outbound/connections/${channel.connectionId}/uploads`, file, { params: { filename: file.name }, headers: { "Content-Type": file.type } });
          entry.setPending({ ...common, type: "media", uploadId: upload.data.id, ...(text.trim() && !file.type.startsWith("audio/") ? { caption: text.trim() } : {}) });
        }
      }
      const result = await api.post<OfficialCommand>(`/whatsapp/outbound/connections/${channel.connectionId}/messages`, entry.getPending());
      entry.setPending(null); setUncertainRequest(false);
      setText(""); setValues({}); setFile(null); onCancelReply(); refresh();
      if (result.data.status === "uncertain") toast.warning("A Meta não confirmou o resultado. O envio permanece em revisão, sem reenvio automático.");
      else if (result.data.status === "failed") toast.error(result.data.safeError ?? "Envio recusado");
      else toast.success(result.data.status === "accepted" ? "Mensagem aceita pela Meta" : "Mensagem na fila de envio");
    } catch (error) {
      const failure = error as ApiError;
      if (failure.code === "NETWORK" && entry.getPending()) setUncertainRequest(true);
      else { entry.setPending(null); setUncertainRequest(false); }
      toast.error(failure.message ?? "Não foi possível preparar o envio");
    } finally { entry.setLocked(false); setBusy(false); }
  };
  const sync = async () => {
    if (entry.isLocked()) return;
    entry.setLocked(true); setBusy(true);
    try { await api.post(`/whatsapp/outbound/connections/${channel.connectionId}/templates/sync`, {}); await templates.refetch(); }
    catch (error) { toast.error((error as ApiError).message); }
    finally { entry.setLocked(false); setBusy(false); }
  };
  return <div className="shrink-0 space-y-2 border-t p-3">
    <p className="text-xs text-muted-foreground">{windowOpen ? `Janela aberta até ${new Date(channel.serviceWindowExpiresAt!).toLocaleString("pt-BR")}` : "Janela de 24h encerrada. Use um template aprovado."}</p>
    {!connected && <p role="alert" className="text-sm text-destructive">Conexão indisponível ou credencial expirada.</p>}
    {!identity && <p role="alert" className="text-sm text-destructive">O contato precisa de uma identidade oficial vigente.</p>}
    {!quotedAllowed && <p role="alert" className="text-sm text-destructive">A mensagem citada pertence a outro número. Cancele a citação ou selecione o canal de origem.</p>}
    {replyTo && <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-xs"><span className="truncate">Respondendo: {replyTo.text ?? "Mensagem com mídia"}</span><Button size="icon" variant="ghost" aria-label="Cancelar resposta" onClick={onCancelReply} disabled={busy || uncertainRequest}><X className="size-4" /></Button></div>}
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Tipo de envio oficial" className="h-8 rounded-md border bg-background px-2 text-sm" value={mode} disabled={busy || uncertainRequest} onChange={event => setMode(event.target.value as typeof mode)}><option value="text" disabled={!windowOpen}>Texto</option><option value="template">Template aprovado</option><option value="media" disabled={!windowOpen}>Arquivo</option></select>
      {mode === "template" && <><select aria-label="Template" className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm" value={templateId} disabled={busy || uncertainRequest} onChange={event => { setTemplateId(event.target.value); setValues({}); setFile(null); }}><option value="">Selecione um template</option>{templates.data?.filter(templateSupported).map(item => <option key={item.id} value={item.id}>{item.name} ({item.language})</option>)}</select><Button variant="ghost" size="sm" onClick={sync} disabled={busy || uncertainRequest || !connected}><RefreshCw className="size-3.5" />Sincronizar</Button></>}
      {mode === "media" && <label className="flex min-w-0 cursor-pointer items-center gap-1 text-sm"><Paperclip className="size-4" /><span className="max-w-52 truncate">{file?.name ?? "Escolher arquivo"}</span><input aria-label="Arquivo para envio" type="file" className="sr-only" accept={acceptedMedia} disabled={busy || uncertainRequest} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
    </div>
    {mode === "template" && template && <TemplateFields template={template} values={values} onChange={(key, value) => setValues({ ...entry.get().values, [key]: value })} disabled={busy || uncertainRequest} />}
    {mode === "template" && headerFormat && <label className="flex cursor-pointer items-center gap-2 text-sm"><Paperclip className="size-4" /><span className="truncate">{file?.name ?? (headerFormat === "IMAGE" ? "Escolher imagem do cabeçalho (até 5 MiB)" : headerFormat === "VIDEO" ? "Escolher vídeo do cabeçalho (até 16 MiB)" : "Escolher PDF do cabeçalho (até 16 MiB)")}</span><input aria-label="Arquivo do cabeçalho do template" type="file" accept={headerAccept} className="sr-only" disabled={busy || uncertainRequest} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
    {mode !== "template" && <Textarea aria-label={mode === "text" ? "Mensagem oficial" : "Legenda do arquivo"} placeholder={mode === "text" ? "Digite sua mensagem" : "Legenda opcional"} value={text} maxLength={mode === "text" ? 4096 : 1024} disabled={busy || uncertainRequest || (mode === "media" && !!file?.type.startsWith("audio/"))} onChange={event => setText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !busy && !invalid && !uncertainRequest) { event.preventDefault(); void submit(); } }} className="max-h-32 min-h-16 resize-y" />}
    {mode === "media" && <p className="text-xs text-muted-foreground">JPEG/PNG até 5 MiB. MP3, OGG/Opus, MP4 e PDF até 16 MiB.</p>}
    {uncertainRequest && <p role="alert" className="text-sm">A conexão caiu após solicitar o envio. Consulte a mesma solicitação antes de preparar outra.</p>}
    {identity && channel.connectionId && (role === "owner" || role === "admin") && <ComposerCost connectionId={channel.connectionId} identityId={identity.id} type={mode} templateId={templateId} />}
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter para enviar</span>{(role === "owner" || role === "admin") && <Link className="text-xs text-primary underline" href="/integracoes/whatsapp?tab=templates">Gerenciar templates</Link>}<Button onClick={submit} disabled={busy || (!uncertainRequest && invalid)}><Send className="size-4" />{busy ? "Aguarde…" : uncertainRequest ? "Consultar solicitação" : "Enviar pelo oficial"}</Button></div>
  </div>;
};
