"use client";

import { useState } from "react";
import { endOfDay, format, startOfDay, subDays } from "date-fns";
import { CalendarIcon, Download, Filter, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, AUDIT_SOURCE_LABELS } from "@/lib/labels";
import { auditExportUrl, useAuditActors } from "@/lib/queries/audit";
import type { AuditAction, AuditEntity, AuditSource } from "@/lib/types";
import type { useAuditFilters } from "./use-audit-filters";

const ENTITY_OPTIONS = Object.entries(AUDIT_ENTITY_LABELS) as [AuditEntity, string][];
const ACTION_OPTIONS = Object.entries(AUDIT_ACTION_LABELS) as [AuditAction, string][];

// Rótulo -> AuditSource: os três atores sintéticos (Automação/WhatsApp/Sistema) chegam da API com
// `actorId: null`, e é o nome — não o id — que diz de qual origem eles são.
const SOURCE_BY_LABEL = Object.fromEntries(
  Object.entries(AUDIT_SOURCE_LABELS).map(([source, label]) => [label, source]),
) as Record<string, AuditSource>;

const PERIOD_PRESETS: { label: string; days: number }[] = [
  { label: "Hoje", days: 0 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

const toDateInputValue = (date: Date | null) => (date ? format(date, "yyyy-MM-dd") : "");
const fromDateInputValue = (value: string) => (value ? new Date(`${value}T00:00:00`) : null);

const MultiSelectFilter = <T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: [T, string][];
  selected: T[];
  onChange: (values: T[]) => void;
}) => {
  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        {label}
        {selected.length > 0 && <Badge variant="secondary">{selected.length}</Badge>}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map(([value, optionLabel]) => (
                <CommandItem
                  key={value}
                  value={optionLabel}
                  data-checked={selected.includes(value)}
                  onSelect={() => toggle(value)}
                >
                  {optionLabel}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

type FiltersState = ReturnType<typeof useAuditFilters>;

const FilterControls = ({ state }: { state: FiltersState }) => {
  const { filters, setFilters, qInput, setQ, hasActiveFilters, clearAll } = state;
  const { data: actors } = useAuditActors();

  const applyPreset = (days: number) => {
    const now = new Date();
    void setFilters({ from: days === 0 ? startOfDay(now) : startOfDay(subDays(now, days)), to: now });
  };

  // Valor único no Select: id real do ator, ou `source:<AuditSource>` para os sintéticos — actorId
  // é `null` para os três (D4), então só o nome distingue um do outro.
  const actorValue = filters.actorId ? filters.actorId : filters.source ? `source:${filters.source}` : "ALL";

  // o gatilho precisa do nome, não do id: o value é `actorId` ou `source:<ORIGEM>` para os sintéticos
  const actorLabel = (value: string) =>
    value.startsWith("source:")
      ? AUDIT_SOURCE_LABELS[value.slice("source:".length) as AuditSource]
      : actors?.find((actor) => actor.actorId === value)?.actorName;

  const onActorChange = (value: string | null) => {
    if (!value || value === "ALL") return void setFilters({ actorId: null, source: null });
    if (value.startsWith("source:")) {
      return void setFilters({ actorId: null, source: value.slice("source:".length) as AuditSource });
    }
    void setFilters({ actorId: value, source: null });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por lead, negócio, ator…"
          className="pl-8"
          value={qInput}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_PRESETS.map((preset) => (
          <Button key={preset.label} variant="outline" size="sm" onClick={() => applyPreset(preset.days)}>
            {preset.label}
          </Button>
        ))}
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>
            <CalendarIcon className="size-4" />
            Personalizado
          </PopoverTrigger>
          <PopoverContent className="w-56" align="start">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                De
                <input
                  type="date"
                  value={toDateInputValue(filters.from)}
                  onChange={(e) => setFilters({ from: fromDateInputValue(e.target.value) })}
                  className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Até
                <input
                  type="date"
                  value={toDateInputValue(filters.to)}
                  onChange={(e) => {
                    const date = fromDateInputValue(e.target.value);
                    setFilters({ to: date ? endOfDay(date) : null });
                  }}
                  className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground"
                />
              </label>
            </div>
          </PopoverContent>
        </Popover>

        <MultiSelectFilter
          label="Tipo"
          options={ENTITY_OPTIONS}
          selected={filters.entityType}
          onChange={(entityType) => setFilters({ entityType })}
        />
        <MultiSelectFilter
          label="Ação"
          options={ACTION_OPTIONS}
          selected={filters.action}
          onChange={(action) => setFilters({ action })}
        />

        <Select value={actorValue} onValueChange={onActorChange}>
          <SelectTrigger size="sm">
            {/* função de render, e não `SelectValue` puro: sem ela o gatilho mostra o value cru
                ("ALL") em vez do rótulo do item — mesmo padrão de `property-dialog.tsx` */}
            <SelectValue>
              {(value: string) =>
                value === "ALL"
                  ? "Todos os atores"
                  : (actorLabel(value) ?? "Todos os atores")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os atores</SelectItem>
            {actors?.map((actor) => (
              <SelectItem
                key={actor.actorId ?? `source:${SOURCE_BY_LABEL[actor.actorName] ?? actor.actorName}`}
                value={actor.actorId ?? `source:${SOURCE_BY_LABEL[actor.actorName] ?? actor.actorName}`}
              >
                {actor.actorName} ({actor.events})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.source ?? "ALL"}
          onValueChange={(value) =>
            setFilters({ source: !value || value === "ALL" ? null : (value as AuditSource), actorId: null })
          }
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {(value: string) =>
                value === "ALL" ? "Toda origem" : AUDIT_SOURCE_LABELS[value as AuditSource]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toda origem</SelectItem>
            {(Object.entries(AUDIT_SOURCE_LABELS) as [AuditSource, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filters.requestId && (
          <Badge variant="secondary" className="gap-1">
            Mesma operação
            <button type="button" aria-label="Remover filtro de operação" onClick={() => setFilters({ requestId: null })}>
              <X className="size-3" />
            </button>
          </Badge>
        )}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Limpar filtros
          </Button>
        )}

        {/* navegação de topo, não fetch: o cookie de sessão viaja e o navegador salva o arquivo. O
            servidor recusa acima de 50 mil linhas pedindo filtro mais estreito, e registra o export
            na própria trilha. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(auditExportUrl(state.searchFilters), "_blank")}
        >
          <Download className="size-4" />
          Exportar CSV
        </Button>
      </div>
    </div>
  );
};

/** Em tela estreita os filtros viram um Sheet: a tabela é quem precisa da largura. */
export const AuditFilters = (props: { state: FiltersState }) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (!isMobile) return <FilterControls state={props.state} />;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Filter className="size-4" />
        Filtros
        {props.state.hasActiveFilters && <Badge variant="secondary">Ativos</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FilterControls state={props.state} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
