"use client";

import { useState, type ReactNode } from "react";
import { addDays, endOfDay, format, parse } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, nurtureReasonLabels } from "@/lib/labels";
import { useOrgDeals } from "@/lib/queries/deals";
import { usePipelines } from "@/lib/queries/pipelines";
import { useNurtureClient, type DealDecision, type NurtureInput } from "@/lib/queries/clients";
import type { Client, NurtureReason } from "@/lib/types";

const REASONS: NurtureReason[] = [
  "ADIADO", "SEM_ORCAMENTO", "SEM_RESPOSTA", "COMPROU_COM_OUTRO", "SO_PESQUISANDO", "OUTRO",
];

// atalhos do "quando retomar": cobrem quase todo caso real e evitam abrir o date picker
const PRESETS = [
  { label: "30 dias", days: 30 },
  { label: "60 dias", days: 60 },
  { label: "90 dias", days: 90 },
  { label: "6 meses", days: 180 },
];

type Decision = { action: DealDecision["action"]; lostStageId?: string };

// Este é o único arquivo que conhece a regra de negócio da nutrição. As três entradas da tela
// /nurturing e as ações das telas existentes só abrem este diálogo.
export const NurtureDialog = ({
  client,
  trigger,
  open,
  onOpenChange,
  onDone,
}: {
  client: Pick<Client, "id" | "name">;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onDone?: () => void;
}) => {
  // modo trigger é descontrolado (sem `open`/`onOpenChange` de fora): o estado interno cobre esse
  // caso, e o modo controlado (Task 5, sem trigger) usa o `open` recebido em vez dele
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const nurture = useNurtureClient();
  const { deals, isLoading: loadingDeals } = useOrgDeals();
  const { data: pipelines } = usePipelines();

  const [reason, setReason] = useState<NurtureReason>("ADIADO");
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const openDeals = deals.filter((deal) => deal.clientId === client.id && deal.isOpen);

  // negócio sem decisão explícita ainda entra no payload como "manter no funil" — nunca falta
  // decisão, o que a API recusaria com 422 DEALS_NOT_COVERED
  const decisionOf = (dealId: string): Decision => decisions[dealId] ?? { action: "KEEP" };

  const lostStagesOf = (pipelineId: string) =>
    (pipelines ?? [])
      .find((p) => p.id === pipelineId)
      ?.stages.filter((stage) => stage.isLost)
      .sort((a, b) => a.position - b.position) ?? [];

  const submit = async () => {
    const input: NurtureInput = {
      reason,
      // a API recusa string vazia (`min(1)`); o campo em branco tem que sumir do payload
      note: note.trim() || undefined,
      until: until ? endOfDay(parse(until, "yyyy-MM-dd", new Date())).toISOString() : undefined,
      deals: openDeals.map((deal) => ({ dealId: deal.id, ...decisionOf(deal.id) })),
    };
    try {
      await nurture.mutateAsync({ id: client.id, input });
      toast.success("Lead enviado para nutrição");
      setOpen(false);
      onDone?.();
    } catch {
      toast.error("Não foi possível enviar para nutrição");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar {client.name} para nutrição</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={(v) => setReason((v as NurtureReason) ?? "ADIADO")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: NurtureReason) => nurtureReasonLabels[v] ?? "Motivo"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {nurtureReasonLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nurture-note">Detalhe</Label>
            <Textarea
              id="nurture-note"
              rows={3}
              placeholder="O que o lead disse? (opcional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Retomar em</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const value = format(addDays(new Date(), preset.days), "yyyy-MM-dd");
                return (
                  <Button
                    key={preset.label}
                    type="button"
                    variant={until === value ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setUntil(value)}
                  >
                    {preset.label}
                  </Button>
                );
              })}
              <Button
                type="button"
                variant={until === "" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setUntil("")}
              >
                Sem data
              </Button>
            </div>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>

          {openDeals.length > 0 && (
            <div className="space-y-3">
              <Label>Negócios abertos</Label>
              {openDeals.map((deal) => {
                const decision = decisionOf(deal.id);
                const lostStages = lostStagesOf(deal.pipelineId);
                return (
                  <div key={deal.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{deal.title}</span>
                      <span className="text-muted-foreground">{formatCurrency(deal.value)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{deal.stageName}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant={decision.action === "KEEP" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() =>
                          setDecisions((d) => ({ ...d, [deal.id]: { action: "KEEP" } }))
                        }
                      >
                        Manter no funil
                      </Button>
                      <Button
                        type="button"
                        variant={decision.action === "CLOSE_LOST" ? "secondary" : "outline"}
                        size="sm"
                        disabled={lostStages.length === 0}
                        onClick={() =>
                          setDecisions((d) => ({
                            ...d,
                            [deal.id]: { action: "CLOSE_LOST", lostStageId: lostStages[0]?.id },
                          }))
                        }
                      >
                        Fechar como perdido
                      </Button>
                      {lostStages.length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          Este funil não tem estágio de perda
                        </span>
                      )}
                    </div>
                    {decision.action === "CLOSE_LOST" && (
                      <Select
                        value={decision.lostStageId}
                        onValueChange={(v) =>
                          setDecisions((d) => ({
                            ...d,
                            [deal.id]: { action: "CLOSE_LOST", lostStageId: v ?? undefined },
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(v: string) => lostStages.find((s) => s.id === v)?.name ?? "Estágio"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {lostStages.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={nurture.isPending || loadingDeals}>
            {nurture.isPending ? "Enviando…" : "Enviar para nutrição"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
