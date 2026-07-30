"use client";

import { useState } from "react";
import { toast } from "sonner";
import { currencyToInput, formatCurrencyInput, parseCurrencyInput } from "@/lib/labels";
import { useClients } from "@/lib/queries/clients";
import { useCreateDeal, useUpdateDeal } from "@/lib/queries/deals";
import { useMembers } from "@/lib/queries/members";
import { useProperties } from "@/lib/queries/properties";
import type { Deal, Stage } from "@/lib/types";
import { Button } from "@/components/ui/button";
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

// Sentinela do "sem vínculo": o Select precisa de um valor de verdade em cada item, e string vazia
// se confunde com "nada selecionado".
const NONE = "none";

export const DealForm = ({
  pipelineId,
  stages,
  deal,
  defaultStageId,
  onSaved,
}: {
  pipelineId: string;
  stages: Stage[];
  deal?: Deal;
  defaultStageId?: string;
  onSaved?: () => void;
}) => {
  const editing = !!deal;
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const { data: clients } = useClients({ status: "ALL" });
  const { data: properties } = useProperties();
  const { data: members } = useMembers();

  const [title, setTitle] = useState(deal?.title ?? "");
  const [clientId, setClientId] = useState(deal?.clientId ?? "");
  const [stageId, setStageId] = useState(deal?.stageId ?? defaultStageId ?? stages[0]?.id ?? "");
  // state guarda o valor já formatado (1.250.000,00); vira número só no submit
  const [value, setValue] = useState(currencyToInput(deal?.value));
  const [propertyId, setPropertyId] = useState(deal?.propertyId ?? NONE);
  const [ownerId, setOwnerId] = useState(deal?.ownerId ?? NONE);
  const [lostReason, setLostReason] = useState(deal?.lostReason ?? "");

  const saving = create.isPending || update.isPending;
  const selectedStage = stages.find((stage) => stage.id === stageId);
  // o motivo só interessa em estágio de perda, mas continua visível se já houver um salvo — senão
  // o texto ficaria escondido no banco sem jeito de apagar
  const showLostReason = !!selectedStage?.isLost || !!lostReason;

  const submit = async () => {
    if (!title.trim() || !clientId || !stageId) return;
    // `null` (e não `undefined`) nos opcionais: é o que a API entende como limpar o campo
    const input = {
      title: title.trim(),
      clientId,
      pipelineId,
      stageId,
      value: parseCurrencyInput(value) ?? null,
      propertyId: propertyId === NONE ? null : propertyId,
      ownerId: ownerId === NONE ? null : ownerId,
      lostReason: lostReason.trim() || null,
    };
    try {
      if (editing) await update.mutateAsync({ id: deal.id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? "Negócio atualizado" : "Negócio criado");
      onSaved?.();
    } catch {
      toast.error("Não foi possível salvar o negócio");
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="deal-title">Título</Label>
        <Input id="deal-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Cliente</Label>
          <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
            <SelectTrigger className="w-full">
              {/* sem a função, o trigger mostra o id cru em vez do nome */}
              <SelectValue>
                {(v: string) => clients?.find((c) => c.id === v)?.name ?? "Selecione um cliente"}
              </SelectValue>
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

        <div className="space-y-1.5">
          <Label>Responsável</Label>
          <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? NONE)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) =>
                  v === NONE ? "Sem responsável" : (members?.find((m) => m.userId === v)?.name ?? "Sem responsável")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem responsável</SelectItem>
              {members?.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Estágio</Label>
          <Select
            value={stageId}
            onValueChange={(v) => {
              const next = v ?? "";
              setStageId(next);
              // tirar o negócio da perda apaga o motivo, igual ao arrasto no kanban: sem isto o
              // negócio reaberto seguiria carregando um "perdido porque…" que não vale mais.
              // O texto continua no histórico.
              if (!stages.find((stage) => stage.id === next)?.isLost) setLostReason("");
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => stages.find((s) => s.id === v)?.name ?? "Estágio"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="deal-value">Valor</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              R$
            </span>
            <Input
              id="deal-value"
              inputMode="numeric"
              placeholder="0,00"
              className="pl-9 text-right tabular-nums"
              value={value}
              onChange={(e) => setValue(formatCurrencyInput(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Imóvel</Label>
        <Select value={propertyId} onValueChange={(v) => setPropertyId(v ?? NONE)}>
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string) =>
                v === NONE ? "Sem imóvel vinculado" : (properties?.find((p) => p.id === v)?.title ?? "Sem imóvel vinculado")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem imóvel vinculado</SelectItem>
            {properties?.map((property) => (
              <SelectItem key={property.id} value={property.id}>
                {property.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showLostReason && (
        <div className="space-y-1.5">
          <Label htmlFor="deal-lost-reason">Motivo da perda</Label>
          <Textarea
            id="deal-lost-reason"
            rows={2}
            placeholder="Preço, prazo, escolheu outro imóvel…"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
          />
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button onClick={submit} disabled={saving || !title.trim() || !clientId || !stageId}>
          {saving ? "Salvando…" : editing ? "Salvar alterações" : "Criar negócio"}
        </Button>
      </div>
    </div>
  );
};
