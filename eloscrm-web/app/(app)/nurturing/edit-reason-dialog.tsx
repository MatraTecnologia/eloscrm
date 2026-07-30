"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { REASONS } from "@/components/app/nurture-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api";
import { nurtureReasonLabels } from "@/lib/labels";
import { useUpdateClient } from "@/lib/queries/clients";
import type { Client, NurtureReason } from "@/lib/types";

export const EditReasonDialog = ({ client, trigger }: { client: Client; trigger: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<NurtureReason>(client.nurtureReason ?? "ADIADO");
  const [note, setNote] = useState(client.nurtureNote ?? "");
  const update = useUpdateClient();

  // o diálogo não desmonta ao fechar: sem isto, reabrir traz o rascunho anterior em vez do motivo
  // atual do lead, o mesmo problema que o reschedule-popover.tsx resolve no onOpenChange dele
  const onOpenChange = (next: boolean) => {
    if (next) {
      setReason(client.nurtureReason ?? "ADIADO");
      setNote(client.nurtureNote ?? "");
    }
    setOpen(next);
  };

  const submit = async () => {
    try {
      await update.mutateAsync({
        id: client.id,
        input: { nurtureReason: reason, nurtureNote: note.trim() || null },
      });
      toast.success("Motivo atualizado");
      setOpen(false);
    } catch (e) {
      toast.error((e as ApiError)?.message ?? "Não foi possível atualizar o motivo");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar motivo de {client.name}</DialogTitle>
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
            <Label htmlFor="edit-reason-note">Detalhe</Label>
            <Textarea
              id="edit-reason-note"
              rows={3}
              placeholder="O que o lead disse? (opcional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
