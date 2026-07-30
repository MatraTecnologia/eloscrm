"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useCreateActivity, useUpdateActivity } from "@/lib/queries/activities";
import { useClients } from "@/lib/queries/clients";
import { useOrgDeals } from "@/lib/queries/deals";
import { activityTypeLabels } from "@/lib/labels";
import type { Activity, ActivityType } from "@/lib/types";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACTIVITY_TYPES: ActivityType[] = ["CALL", "VISIT", "PROPOSAL", "NOTE"];

// Sentinela do "sem vínculo": o Select precisa de um valor de verdade em cada item, e string
// vazia se confunde com "nada selecionado".
const NONE = "none";

// O input datetime-local trabalha em horário local; toISOString/slice renderizaria UTC e jogaria
// todo horário 3h para trás no fuso de Brasília.
const toLocalInput = (iso: string | null | undefined) =>
  iso ? format(parseISO(iso), "yyyy-MM-dd'T'HH:mm") : "";

export const ActivityDialog = ({
  activity,
  defaultClientId,
  defaultDealId,
  trigger,
}: {
  activity?: Activity;
  defaultClientId?: string;
  defaultDealId?: string;
  trigger: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const editing = !!activity;
  const create = useCreateActivity();
  const update = useUpdateActivity();
  // status: "ALL" — o corretor precisa poder registrar atividade num lead nutrido sem reativá-lo
  const { data: clients } = useClients({ status: "ALL" });
  const { deals } = useOrgDeals();

  const [type, setType] = useState<ActivityType>(activity?.type ?? "CALL");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [dueAt, setDueAt] = useState(toLocalInput(activity?.dueAt));
  const [clientId, setClientId] = useState(activity?.clientId ?? defaultClientId ?? NONE);
  const [dealId, setDealId] = useState(activity?.dealId ?? defaultDealId ?? NONE);

  const saving = create.isPending || update.isPending;
  // negócio sempre pertence a um cliente: com um cliente escolhido, só faz sentido oferecer os dele
  const dealOptions = clientId === NONE ? deals : deals.filter((d) => d.clientId === clientId);

  // o dialog não desmonta ao fechar e o state só nasce na montagem: sem isto, reabrir traz o
  // rascunho anterior (ou dados desatualizados da atividade, se ela mudou nesse meio-tempo)
  const onOpenChange = (next: boolean) => {
    if (next) {
      setType(activity?.type ?? "CALL");
      setDescription(activity?.description ?? "");
      setDueAt(toLocalInput(activity?.dueAt));
      setClientId(activity?.clientId ?? defaultClientId ?? NONE);
      setDealId(activity?.dealId ?? defaultDealId ?? NONE);
    }
    setOpen(next);
  };

  const submit = async () => {
    if (!description.trim() || !dueAt) return;
    const input = {
      type,
      description: description.trim(),
      // a agenda só lista atividades com dueAt; salvar sem data faria o item sumir da tela em que
      // acabou de ser criado. Daí o campo ser obrigatório aqui.
      dueAt: new Date(dueAt).toISOString(),
      clientId: clientId === NONE ? null : clientId,
      dealId: dealId === NONE ? null : dealId,
    };
    try {
      if (editing) await update.mutateAsync({ id: activity.id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? "Atividade atualizada" : "Atividade criada");
      setOpen(false);
    } catch {
      toast.error("Não foi possível salvar a atividade");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar atividade" : "Nova atividade"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v) => setType((v as ActivityType) ?? "CALL")}>
                <SelectTrigger className="w-full">
                  {/* sem a função, o trigger mostra o enum cru (CALL) em vez do rótulo */}
                  <SelectValue>{(v: ActivityType) => activityTypeLabels[v] ?? "Tipo"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {activityTypeLabels[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-due">Data e hora</Label>
              <Input
                id="activity-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="activity-description">Descrição</Label>
            <Textarea
              id="activity-description"
              rows={3}
              placeholder="Ligar para confirmar a visita de sábado"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select
                value={clientId}
                onValueChange={(v) => {
                  setClientId(v ?? NONE);
                  setDealId(NONE);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === NONE ? "Sem vínculo" : (clients?.find((c) => c.id === v)?.name ?? "Sem vínculo")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem vínculo</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Negócio</Label>
              <Select value={dealId} onValueChange={(v) => setDealId(v ?? NONE)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === NONE ? "Sem vínculo" : (deals.find((d) => d.id === v)?.title ?? "Sem vínculo")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem vínculo</SelectItem>
                  {dealOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !description.trim() || !dueAt}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
