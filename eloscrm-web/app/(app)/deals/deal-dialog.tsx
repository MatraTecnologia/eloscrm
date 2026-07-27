"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateDeal, useUpdateDeal } from "@/lib/queries/deals";
import { useClients } from "@/lib/queries/clients";
import type { Deal, Stage } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const DealDialog = ({
  pipelineId,
  stages,
  deal,
  defaultStageId,
  trigger,
  nativeButton,
}: {
  pipelineId: string;
  stages: Stage[];
  deal?: Deal;
  defaultStageId?: string;
  trigger: React.ReactNode;
  nativeButton?: boolean;
}) => {
  const editing = !!deal;
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const { data: clients } = useClients();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(deal?.title ?? "");
  const [clientId, setClientId] = useState(deal?.clientId ?? "");
  const [stageId, setStageId] = useState(deal?.stageId ?? defaultStageId ?? stages[0]?.id ?? "");
  const [value, setValue] = useState(deal?.value ?? "");

  const saving = create.isPending || update.isPending;

  const submit = async () => {
    if (!title.trim() || !clientId || !stageId) return;
    const input = {
      title: title.trim(),
      clientId,
      pipelineId,
      stageId,
      value: value ? Number(value) : undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: deal.id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? "Negócio atualizado" : "Negócio criado");
      setOpen(false);
    } catch {
      toast.error("Não foi possível salvar o negócio");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={nativeButton} render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar negócio" : "Novo negócio"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="deal-title">Título</Label>
            <Input id="deal-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Estágio</Label>
              <Select value={stageId} onValueChange={(v) => setStageId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Estágio" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-value">Valor (R$)</Label>
              <Input id="deal-value" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !title.trim() || !clientId || !stageId}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
