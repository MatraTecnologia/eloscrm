"use client";

import { PhoneOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatPhone } from "@/lib/labels";
import type { BroadcastPreviewRow, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TagChip } from "./tag-chip";

/**
 * Quem o filtro devolveu, para marcar e desmarcar. Lead sem telefone válido aparece desabilitado,
 * e não some: a pessoa precisa ver quem ficou de fora, e por quê, antes de disparar.
 */
export const BroadcastRecipients = ({
  rows,
  stages,
  selected,
  onChange,
}: {
  rows: BroadcastPreviewRow[];
  stages: Stage[];
  selected: string[];
  onChange: (next: string[]) => void;
}) => {
  const [search, setSearch] = useState("");
  const eligible = rows.filter(row => row.sendable);
  const batch = eligible.slice(0, 200);
  const allSelected = batch.length > 0 && batch.every(row => selected.includes(row.dealId));
  const visible = rows.filter(row => `${row.client.name} ${row.client.phone ?? ""} ${row.title}`.toLowerCase().includes(search.toLowerCase()));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < 200 ? [...selected, id] : selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input aria-label="Buscar destinatário" placeholder="Buscar pessoa, telefone ou negócio" value={search} onChange={event => setSearch(event.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={allSelected}
          indeterminate={!allSelected && selected.length > 0}
          onCheckedChange={() => onChange(allSelected ? [] : batch.map(row => row.dealId))}
          aria-label="Selecionar até 200 destinatários"
        />
        <span>
          {selected.length} de {eligible.length} selecionados · limite de 200
          {eligible.length < rows.length && (
            <span className="text-muted-foreground">
              {" "}
              · {rows.length - eligible.length} {rows.length - eligible.length === 1 ? "excluído" : "excluídos"}
            </span>
          )}
        </span>
      </label>
      <ScrollArea className="-mr-2 min-h-0 flex-1 scroll-fade">
        <div className="space-y-1.5 pr-3">
          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              Nenhum negócio passa nas condições
            </div>
          )}
          {visible.map((row) => (
            <label
              key={row.dealId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm transition-colors",
                row.sendable ? "hover:bg-muted/50" : "cursor-not-allowed opacity-60",
                selected.includes(row.dealId) && "border-primary/50 bg-primary/5",
              )}
            >
              <Checkbox
                disabled={!row.sendable || (!selected.includes(row.dealId) && selected.length >= 200)}
                checked={selected.includes(row.dealId)}
                onCheckedChange={() => toggle(row.dealId)}
                className="mt-0.5"
                aria-label={`Selecionar ${row.client.name}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium">{row.client.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {row.sendable ? (
                      formatPhone(row.client.phone)
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <PhoneOff className="size-3" /> {row.exclusion ?? "sem telefone"}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">{row.title}</span>
                  <span>· {stageName.get(row.stageId) ?? "—"}</span>
                  {row.value != null && <span>· {formatCurrency(row.value)}</span>}
                  {row.tags.map((tag) => (
                    <TagChip key={tag.id} tag={tag} />
                  ))}
                </div>
              </div>
            </label>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
