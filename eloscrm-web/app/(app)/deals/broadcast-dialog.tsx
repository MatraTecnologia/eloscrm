"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, ChevronRight, Send } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBroadcasts, useCreateBroadcast, usePreviewBroadcast } from "@/lib/queries/broadcasts";
import { useWhatsappInstance } from "@/lib/queries/whatsapp";
import type { BroadcastFilters, BroadcastPreviewRow, Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BroadcastFiltersForm } from "./broadcast-filters";
import { BroadcastMessage } from "./broadcast-message";
import { BroadcastProgress, BroadcastStatusBadge } from "./broadcast-progress";
import { BroadcastRecipients } from "./broadcast-recipients";
import { CampaignPanel } from "@/components/whatsapp-official/campaign-panel";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useMembers } from "@/lib/queries/members";
import { CampaignPermission } from "@/components/whatsapp-official/campaign-permission";

const TAB_CLASS = "data-active:text-primary after:bg-primary";
const STEPS = ["Condições", "Destinatários", "Mensagem"] as const;

const Stepper = ({ current }: { current: number }) => (
  <ol className="flex items-center gap-1 text-xs">
    {STEPS.map((label, i) => (
      <li key={label} className="flex items-center gap-1">
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
            i === current
              ? "bg-primary text-primary-foreground"
              : i < current
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
          )}
        >
          {i + 1}
        </span>
        <span className={cn(i === current ? "font-medium" : "text-muted-foreground")}>{label}</span>
        {i < STEPS.length - 1 && <ChevronRight className="size-3 text-muted-foreground" />}
      </li>
    ))}
  </ol>
);

/**
 * Disparo em massa para os negócios do funil aberto. Três etapas numa tela só: condições →
 * destinatários (que a pessoa ainda pode desmarcar) → mensagem com variáveis. Depois de enviar, o
 * mesmo dialog mostra o andamento; o histórico fica na outra aba.
 */
export const BroadcastDialog = ({
  pipeline,
  trigger,
}: {
  pipeline: Pipeline;
  trigger: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"novo" | "historico" | "official">("novo");
  const [step, setStep] = useState(0);
  const [filters, setFilters] = useState<BroadcastFilters>({});
  const [rows, setRows] = useState<BroadcastPreviewRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [permissionClient, setPermissionClient] = useState("");
  const permissionClients = [...new Map(rows.map(row => [row.client.id, row.client])).values()];
  const permission = permissionClients.find(client => client.id === permissionClient);

  const { data: instance } = useWhatsappInstance();
  const { data: org } = useActiveOrganization(); const { data: session } = useSession(); const { data: members } = useMembers();
  const role = members?.find(member => member.userId === session?.user.id)?.role;
  const isManager = role === "owner" || role === "admin";
  const preview = usePreviewBroadcast();
  const create = useCreateBroadcast();
  const { data: history } = useBroadcasts(pipeline.id, open);

  const conectado = instance?.status === "connected";
  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);
  const escolhidos = rows.filter((r) => selected.includes(r.dealId));

  const reset = () => {
    setTab(isManager ? "official" : "novo");
    setStep(0);
    setFilters({});
    setRows([]);
    setSelected([]);
    setText("");
    setViewing(null);
    setPermissionClient("");
  };

  const loadRecipients = async () => {
    try {
      const result = await preview.mutateAsync({ pipelineId: pipeline.id, filters });
      setRows(result);
      // começa com todo mundo que dá para enviar marcado: desmarcar é a exceção
      setSelected(result.filter((r) => r.sendable).map((r) => r.dealId));
      setStep(1);
    } catch {
      toast.error("Não foi possível buscar os destinatários");
    }
  };

  const disparar = async () => {
    try {
      const broadcast = await create.mutateAsync({
        pipelineId: pipeline.id,
        filters,
        dealIds: selected,
        text: text.trim(),
      });
      toast.success(`Disparo iniciado para ${broadcast.total - broadcast.skipped} pessoas`);
      setViewing(broadcast.id);
      setTab("historico");
    } catch (e) {
      const code = (e as { code?: string })?.code;
      toast.error(
        code === "INSTANCE_NOT_CONNECTED"
          ? "Conecte o WhatsApp antes de disparar"
          : "Não foi possível iniciar o disparo",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-y-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Disparo · {pipeline.name}</DialogTitle>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "novo" | "historico" | "official");
            if (v === "novo") setViewing(null);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList variant="line" className="h-auto max-w-full flex-wrap">
            {isManager && <TabsTrigger value="official" className={TAB_CLASS}>WhatsApp oficial</TabsTrigger>}
            <TabsTrigger value="novo" className={TAB_CLASS}>
              uazapi
            </TabsTrigger>
            <TabsTrigger value="historico" className={TAB_CLASS}>
              Histórico uazapi
            </TabsTrigger>
          </TabsList>
          {isManager && <TabsContent value="official" className="mt-4 flex min-h-0 min-w-0 flex-1 flex-col"><CampaignPanel key={`${org?.id}:${pipeline.id}`} pipeline={pipeline} /></TabsContent>}

          <TabsContent value="novo" className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
            {!conectado && (
              <Alert>
                <AlertTitle>WhatsApp desconectado</AlertTitle>
                <AlertDescription>
                  Dá para montar o disparo, mas o envio exige o número conectado.{" "}
                  <Link href="/integracoes/whatsapp" className="underline">
                    Abrir integrações
                  </Link>
                </AlertDescription>
              </Alert>
            )}
            <Stepper current={step} />

            {step === 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <BroadcastFiltersForm pipeline={pipeline} filters={filters} onChange={setFilters} />
              </div>
            )}
            {step === 1 && (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <p className="text-xs text-muted-foreground">O disparo exige autorização registrada para o telefone de cada pessoa. Administradores podem registrar a evidência abaixo.</p>
                {isManager && <label className="block text-sm">Permissão de comunicação<select aria-label="Permissão de comunicação uazapi" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={permissionClient} onChange={event => setPermissionClient(event.target.value)}><option value="">Consultar uma pessoa</option>{permissionClients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
                {isManager && permission && <CampaignPermission key={`${org?.id}:${permission.id}`} clientId={permission.id} name={permission.name} onSaved={() => { setSelected([]); void loadRecipients(); }} />}
                <div className="flex h-64 min-h-64 flex-col">
                <BroadcastRecipients
                  rows={rows}
                  stages={stages}
                  selected={selected}
                  onChange={setSelected}
                />
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <BroadcastMessage text={text} onChange={setText} sample={escolhidos[0] ?? null} />
              </div>
            )}

            <div className="flex shrink-0 items-center justify-between gap-2 border-t pt-3">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="size-4" /> Voltar
                </Button>
              ) : (
                <span />
              )}
              {step === 0 && (
                <Button onClick={loadRecipients} disabled={preview.isPending}>
                  {preview.isPending ? "Buscando…" : "Ver destinatários"}
                </Button>
              )}
              {step === 1 && (
                <Button onClick={() => setStep(2)} disabled={selected.length === 0}>
                  Escrever mensagem
                </Button>
              )}
              {step === 2 && (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button disabled={!conectado || !text.trim() || create.isPending}>
                        <Send className="size-4" />
                        {create.isPending
                          ? "Iniciando…"
                          : `Disparar para ${escolhidos.length}`}
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirmar disparo</AlertDialogTitle>
                      <AlertDialogDescription>
                        A mensagem será enviada pelo WhatsApp da imobiliária para{" "}
                        {escolhidos.length}{" "}
                        {escolhidos.length === 1 ? "pessoa" : "pessoas"}, com alguns segundos de
                        intervalo entre cada envio. Dá para cancelar o restante a qualquer momento.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Voltar</AlertDialogCancel>
                      <AlertDialogAction onClick={disparar}>Disparar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </TabsContent>

          <TabsContent value="historico" className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
            {viewing ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setViewing(null)}
                >
                  <ArrowLeft className="size-4" /> Todos os disparos
                </Button>
                <BroadcastProgress broadcastId={viewing} />
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {history?.length === 0 && (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Nenhum disparo neste funil ainda
                  </div>
                )}
                <div className="space-y-1.5">
                  {history?.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setViewing(b.id)}
                      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{b.text}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {format(parseISO(b.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })} ·{" "}
                          {b.createdByName} · {b.sent}/{b.total} enviadas
                        </p>
                      </div>
                      <BroadcastStatusBadge status={b.status} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
