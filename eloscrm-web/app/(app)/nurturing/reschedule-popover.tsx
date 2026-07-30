"use client";

import { useState, type ReactNode } from "react";
import { endOfDay, format, parse, parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateClient } from "@/lib/queries/clients";
import type { Client } from "@/lib/types";

export const ReschedulePopover = ({ client, trigger }: { client: Client; trigger: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const update = useUpdateClient();

  // o popover não desmonta ao fechar: sem isto, reabrir traz o rascunho anterior em vez da data
  // atual do lead (mesmo problema que o ClientDialog resolve no onOpenChange dele)
  const onOpenChange = (next: boolean) => {
    if (next) setValue(client.nurtureUntil ? format(parseISO(client.nurtureUntil), "yyyy-MM-dd") : "");
    setOpen(next);
  };

  const save = async (nurtureUntil: string | null) => {
    try {
      await update.mutateAsync({ id: client.id, input: { nurtureUntil } });
      toast.success("Retomada reagendada");
      setOpen(false);
    } catch {
      toast.error("Não foi possível reagendar");
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Reagendar retomada</PopoverTitle>
        </PopoverHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-until">Retomar em</Label>
          <Input
            id="reschedule-until"
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={update.isPending}
            onClick={() => save(null)}
          >
            Sem data
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={update.isPending || !value}
            onClick={() => save(endOfDay(parse(value, "yyyy-MM-dd", new Date())).toISOString())}
          >
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
