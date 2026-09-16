"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  currencyToInput,
  formatCurrencyInput,
  leadTemperatureLabels,
  parseCurrencyInput,
} from "@/lib/labels";
import { useMembers } from "@/lib/queries/members";
import { useTags } from "@/lib/queries/tags";
import type { BroadcastFilters, LeadTemperature, Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";

const TEMPERATURES: LeadTemperature[] = ["FRIO", "MORNO", "QUENTE"];
const ANY = "ANY";

/** Botão que liga e desliga um valor numa lista. A cor, quando vem, pinta a bolinha. */
const Chip = ({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string | null;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
    )}
  >
    {color && <span className="size-2 rounded-full" style={{ background: color }} />}
    {children}
  </button>
);

const toggle = (list: string[] | undefined, id: string) =>
  list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id];

/** Lista vazia vira `undefined`: para a API, condição ausente é "não restringe", e `[]` também — mas
 *  o objeto salvo no disparo fica mais limpo sem chaves vazias. */
const clean = (list: string[]) => (list.length ? list : undefined);

export const BroadcastFiltersForm = ({
  pipeline,
  filters,
  onChange,
}: {
  pipeline: Pipeline;
  filters: BroadcastFilters;
  onChange: (next: BroadcastFilters) => void;
}) => {
  const { data: tags } = useTags();
  const { data: members } = useMembers();
  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position);

  const set = <K extends keyof BroadcastFilters>(key: K, value: BroadcastFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const setList = (key: "stageIds" | "tagsAny" | "tagsNone" | "ownerIds", id: string) =>
    set(key, clean(toggle(filters[key], id)));

  const valueMode = filters.value ?? ANY;
  const replyMode = filters.reply ?? ANY;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Estágios</Label>
        <div className="flex flex-wrap gap-1.5">
          {stages.map((stage) => (
            <Chip
              key={stage.id}
              active={!!filters.stageIds?.includes(stage.id)}
              color={stage.color ?? "var(--chart-1)"}
              onClick={() => setList("stageIds", stage.id)}
            >
              {stage.name}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Nenhum marcado = todos os estágios.</p>
      </div>

      {tags && tags.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tem alguma destas etiquetas</Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Chip
                  key={tag.id}
                  active={!!filters.tagsAny?.includes(tag.id)}
                  color={tag.color}
                  onClick={() => setList("tagsAny", tag.id)}
                >
                  {tag.name}
                </Chip>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Não tem nenhuma destas</Label>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Chip
                  key={tag.id}
                  active={!!filters.tagsNone?.includes(tag.id)}
                  color={tag.color}
                  onClick={() => setList("tagsNone", tag.id)}
                >
                  {tag.name}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Valor do negócio</Label>
          <Select
            value={valueMode}
            onValueChange={(v) => {
              const mode = v === ANY || !v ? undefined : (v as "FILLED" | "EMPTY");
              // vazio não tem faixa: os limites saem junto, senão a API recebe uma condição
              // impossível (nulo e maior que X)
              onChange({
                ...filters,
                value: mode,
                ...(mode === "EMPTY" ? { valueMin: undefined, valueMax: undefined } : {}),
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) =>
                  v === "FILLED" ? "Preenchido" : v === "EMPTY" ? "Vazio" : "Qualquer"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Qualquer</SelectItem>
              <SelectItem value="FILLED">Preenchido</SelectItem>
              <SelectItem value="EMPTY">Vazio</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bc-min">Mínimo</Label>
          <Input
            id="bc-min"
            inputMode="numeric"
            placeholder="0,00"
            disabled={valueMode === "EMPTY"}
            className="text-right tabular-nums"
            value={currencyToInput(filters.valueMin)}
            onChange={(e) =>
              set("valueMin", parseCurrencyInput(formatCurrencyInput(e.target.value)) ?? undefined)
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bc-max">Máximo</Label>
          <Input
            id="bc-max"
            inputMode="numeric"
            placeholder="0,00"
            disabled={valueMode === "EMPTY"}
            className="text-right tabular-nums"
            value={currencyToInput(filters.valueMax)}
            onChange={(e) =>
              set("valueMax", parseCurrencyInput(formatCurrencyInput(e.target.value)) ?? undefined)
            }
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Retorno no WhatsApp</Label>
          <Select
            value={replyMode}
            onValueChange={(v) => {
              const mode = v === ANY || !v ? undefined : (v as "NO_REPLY" | "REPLIED");
              // o prazo só faz sentido para "sem retorno": nos outros modos sai junto
              onChange({
                ...filters,
                reply: mode,
                ...(mode === "NO_REPLY" ? {} : { noReplyDays: undefined }),
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) =>
                  v === "NO_REPLY"
                    ? "Sem retorno após nosso contato"
                    : v === "REPLIED"
                      ? "Respondeu à última mensagem"
                      : "Qualquer"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Qualquer</SelectItem>
              <SelectItem value="NO_REPLY">Sem retorno após nosso contato</SelectItem>
              <SelectItem value="REPLIED">Respondeu à última mensagem</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Olha a última mensagem da conversa do lead. Quem nunca conversou não entra.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bc-days">Sem resposta há (dias)</Label>
          <Input
            id="bc-days"
            type="number"
            min={1}
            max={365}
            placeholder="qualquer"
            disabled={replyMode !== "NO_REPLY"}
            value={filters.noReplyDays ?? ""}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              set("noReplyDays", Number.isFinite(n) && n > 0 ? n : undefined);
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Temperatura do lead</Label>
          <div className="flex flex-wrap gap-1.5">
            {TEMPERATURES.map((t) => (
              <Chip
                key={t}
                active={!!filters.temperatures?.includes(t)}
                onClick={() =>
                  set(
                    "temperatures",
                    clean(toggle(filters.temperatures, t)) as LeadTemperature[] | undefined,
                  )
                }
              >
                {leadTemperatureLabels[t]}
              </Chip>
            ))}
          </div>
        </div>
        {members && members.length > 0 && (
          <div className="space-y-1.5">
            <Label>Responsável</Label>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <Chip
                  key={m.userId}
                  active={!!filters.ownerIds?.includes(m.userId)}
                  onClick={() => setList("ownerIds", m.userId)}
                >
                  {m.name}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
