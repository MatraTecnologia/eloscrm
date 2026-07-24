"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useCreateDeal, useUpdateDeal } from "@/lib/queries/deals";
import { useClients } from "@/lib/queries/clients";
import { dealStageLabels } from "@/lib/labels";
import type { Deal, DealStage } from "@/lib/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const DealDialog = ({ deal, trigger }: { deal?: Deal; trigger: React.ReactNode }) => {
  const editing = !!deal;
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const { data: clients } = useClients();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(deal?.title ?? "");
  const [clientId, setClientId] = useState(deal?.clientId ?? "");
  const [value, setValue] = useState(deal?.value ?? "");
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "NOVO_LEAD");

  const saving = create.isPending || update.isPending;

  const submit = async () => {
    if (!title.trim() || !clientId) return;
    const input = {
      title: title.trim(),
      clientId,
      value: value ? Number(value) : undefined,
      stage,
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
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar negócio" : "Novo negócio"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">Valor</Label>
              <Input id="value" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Etapa</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as DealStage)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(dealStageLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !title.trim() || !clientId}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
