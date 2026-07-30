"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Aberto pelo arrasto do card para um estágio de perda — por isso é controlado, sem trigger. Perder
 * negócio sem registrar o porquê é o dado que mais falta depois, quando alguém vai entender por que
 * o funil não fecha.
 */
export const LostReasonDialog = ({
  open,
  dealTitle,
  stageName,
  saving,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  dealTitle: string;
  stageName: string;
  saving: boolean;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}) => {
  const [reason, setReason] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setReason("");
        onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover para {stageName}</DialogTitle>
          <DialogDescription>
            Por que “{dealTitle}” foi perdido? O motivo fica no negócio e no histórico.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          autoFocus
          placeholder="Preço, prazo, escolheu outro imóvel, sumiu…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setReason("");
              onCancel();
            }}
          >
            Cancelar
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              const value = reason.trim();
              setReason("");
              onConfirm(value || null);
            }}
          >
            {saving ? "Movendo…" : "Mover negócio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
