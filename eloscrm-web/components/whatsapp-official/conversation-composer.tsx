"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, type ApiError } from "@/lib/api";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useInboxRefresh } from "@/lib/queries/inbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import type { InboxChannel, InboxMessage } from "@/lib/messaging-types";
import { OfficialComposer } from "./official-composer";

type ManualRequest = { text: string; idempotencyKey: string; confirmManualException: true };
const pendingRequests = new Map<string, ManualRequest>();

const UazapiManualComposer = ({ channel }: { channel: InboxChannel }) => {
  const { data: session } = useSession();
  const { data: org } = useActiveOrganization();
  const scope = `${session?.session.id}:${org?.id}:${channel.conversationId}`;
  const refresh = useInboxRefresh();
  const [text, setText] = useState(() => pendingRequests.get(scope)?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"send" | "clear" | null>(null);
  const [uncertain, setUncertain] = useState(() => pendingRequests.has(scope));
  const locked = useRef(false);
  const allowed = !!channel.uazapiManual?.allowed;
  const submit = async () => {
    if (locked.current || !allowed || !text.trim()) return;
    locked.current = true; setBusy(true);
    const input = pendingRequests.get(scope) ?? { text: text.trim(), idempotencyKey: crypto.randomUUID(), confirmManualException: true as const };
    pendingRequests.set(scope, input);
    try {
      const result = await api.post<{ status: "sent" | "failed" | "uncertain"; safeError: string | null }>(`/whatsapp/inbox/conversations/${channel.conversationId}/uazapi/messages`, input);
      refresh(); setConfirming(null);
      if (result.data.status === "uncertain") { setUncertain(true); toast.warning(result.data.safeError ?? "Resultado incerto. Confira o WhatsApp antes de outro envio."); }
      else { pendingRequests.delete(scope); setUncertain(false); if (result.data.status === "sent") { setText(""); toast.success("Mensagem enviada pela uazapi"); } else toast.error(result.data.safeError ?? "Envio recusado pela uazapi"); }
    } catch (error) {
      const failure = error as ApiError;
      if (failure.code === "NETWORK") setUncertain(true);
      else { pendingRequests.delete(scope); setUncertain(false); }
      refresh(); toast.error(failure.message ?? "Não foi possível concluir o envio");
    } finally { locked.current = false; setBusy(false); }
  };
  return <div className="space-y-2 border-t p-3">
    <p className="text-xs text-muted-foreground">Envio manual pela uazapi no mesmo número do oficial: {channel.uazapiManual?.number ?? channel.number}. As respostas continuam dependendo da sincronização oficial.</p>
    {!allowed && <p role="alert" className="text-sm text-destructive">{channel.uazapiManual?.reason ?? "A uazapi está indisponível nesta conversa"}</p>}
    <Textarea aria-label="Mensagem pela uazapi" placeholder="Digite sua mensagem" maxLength={4096} className="min-h-16 max-h-32 resize-y" value={text} onChange={event => setText(event.target.value)} disabled={busy || uncertain || !allowed} />
    {uncertain && <p role="alert" className="text-sm">O resultado ficou incerto. Consultar a mesma solicitação não repete o envio. Confira o WhatsApp antes de preparar outra mensagem.</p>}
    <Button disabled={busy || !allowed || !text.trim()} onClick={() => uncertain ? void submit() : setConfirming("send")}>{busy ? "Aguarde…" : uncertain ? "Consultar solicitação" : "Enviar pela uazapi"}</Button>
    {uncertain && <Button variant="ghost" disabled={busy} onClick={() => setConfirming("clear")}>{"Conferi no WhatsApp; preparar outra mensagem"}</Button>}
    <AlertDialog open={!!confirming} onOpenChange={open => { if (!open && !busy) setConfirming(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirming === "clear" ? "Você conferiu o resultado no WhatsApp?" : "Enviar esta mensagem pela uazapi?"}</AlertDialogTitle><AlertDialogDescription>{confirming === "clear" ? "O envio anterior continuará registrado como incerto. Prepare outra mensagem somente após conferir se a anterior chegou, para evitar duplicação." : "O envio usará o mesmo número do WhatsApp oficial. Esta escolha será registrada na auditoria e no histórico da conversa. A mensagem enviada não pode ser desfeita pelo CRM."}</AlertDialogDescription></AlertDialogHeader><p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{text}</p><AlertDialogFooter><AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel><Button disabled={busy} onClick={() => { if (confirming === "clear") { pendingRequests.delete(scope); setUncertain(false); setText(""); setConfirming(null); } else void submit(); }}>{busy ? "Enviando…" : confirming === "clear" ? "Conferi; preparar outra mensagem" : "Confirmar envio pela uazapi"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
};

export const ConversationComposer = ({ channel, replyTo, onCancelReply }: { channel: InboxChannel; replyTo: InboxMessage | null; onCancelReply: () => void }) => {
  const [provider, setProvider] = useState<"cloud_api" | "uazapi">("cloud_api");
  return <div className="shrink-0">
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs"><label>Provedor de envio<select aria-label="Provedor de envio da conversa" className="ml-2 h-8 rounded-md border bg-background px-2 text-sm" value={provider} onChange={event => { setProvider(event.target.value as "cloud_api" | "uazapi"); onCancelReply(); }}><option value="cloud_api">WhatsApp oficial</option>{(channel.uazapiManual?.allowed || provider === "uazapi") && <option value="uazapi" disabled={!channel.uazapiManual?.allowed}>uazapi · mesmo número</option>}</select></label>{!channel.uazapiManual?.allowed && <span className="text-muted-foreground">uazapi disponível somente no mesmo número, com Coexistence e telefone do contato validado.</span>}</div>
    {provider === "cloud_api" ? <OfficialComposer channel={channel} replyTo={replyTo} onCancelReply={onCancelReply} /> : <UazapiManualComposer channel={channel} />}
  </div>;
};
