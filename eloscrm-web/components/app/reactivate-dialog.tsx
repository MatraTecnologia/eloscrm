"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/labels";
import { useOrgDeals } from "@/lib/queries/deals";
import { useReactivateClient, type ReactivateInput } from "@/lib/queries/clients";
import type { Client } from "@/lib/types";

export const ReactivateDialog = ({
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
  // reabrir negócio é decisão consciente do corretor, nunca default: começa sempre vazio
  const [reopenIds, setReopenIds] = useState<string[]>([]);

  // mesma solução do NurtureDialog: o pai não desmonta no modo trigger, então reabrir sem resetar
  // deixaria negócios pré-marcados de uma sessão anterior do diálogo
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (next) setReopenIds([]);
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const reactivate = useReactivateClient();
  const { deals, isLoading: loadingDeals } = useOrgDeals();
  const lostDeals = deals.filter((deal) => deal.clientId === client.id && deal.isLost);

  const submit = async () => {
    const input: ReactivateInput = reopenIds.length ? { reopenDealIds: reopenIds } : {};
    try {
      await reactivate.mutateAsync({ id: client.id, input });
      toast.success("Lead reativado");
      setOpen(false);
      onDone?.();
    } catch {
      toast.error("Não foi possível reativar o lead");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reativar {client.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {client.name} volta para a lista de leads ativos.
          </p>

          {lostDeals.length > 0 && (
            <div className="space-y-3">
              <Label>Reabrir algum negócio? Ele volta para o primeiro estágio aberto do funil.</Label>
              {lostDeals.map((deal) => (
                <Label
                  key={deal.id}
                  className="flex items-start gap-2 rounded-md border p-3 font-normal"
                >
                  <Checkbox
                    checked={reopenIds.includes(deal.id)}
                    onCheckedChange={(checked) =>
                      setReopenIds((ids) =>
                        checked ? [...ids, deal.id] : ids.filter((id) => id !== deal.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{deal.title}</span>
                      <span className="text-muted-foreground">{formatCurrency(deal.value)}</span>
                    </span>
                    {deal.lostReason && (
                      <span className="block text-xs text-muted-foreground">{deal.lostReason}</span>
                    )}
                  </span>
                </Label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={reactivate.isPending || loadingDeals}>
            {reactivate.isPending ? "Reativando…" : "Reativar lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
