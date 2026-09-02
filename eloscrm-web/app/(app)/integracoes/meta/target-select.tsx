"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePipelines } from "@/lib/queries/pipelines";

type Props = {
  pipelineId: string;
  stageId: string;
  onChange: (next: { pipelineId: string; stageId: string }) => void;
  disabled?: boolean;
  /** texto do funil vazio — "Padrão da integração" na linha do formulário, "Escolha o funil" no padrão */
  placeholder?: string;
  size?: "sm" | "default";
};

/**
 * Par funil + estágio, o mesmo do `PipelineCard` da automação de leads. Trocar o funil zera o
 * estágio: estágio de outro funil é exatamente o par que a API recusa.
 */
export const TargetSelect = ({
  pipelineId,
  stageId,
  onChange,
  disabled,
  placeholder = "Escolha o funil",
  size = "default",
}: Props) => {
  const { data: pipelines } = usePipelines();
  const pipeline = pipelines?.find((p) => p.id === pipelineId);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        value={pipelineId}
        onValueChange={(v) => onChange({ pipelineId: v ?? "", stageId: "" })}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" size={size}>
          {/* sem a função, o Base UI mostra o cuid em vez do nome */}
          <SelectValue placeholder={placeholder}>
            {(v: string) => pipelines?.find((p) => p.id === v)?.name ?? ""}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {pipelines?.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={stageId}
        onValueChange={(v) => onChange({ pipelineId, stageId: v ?? "" })}
        disabled={disabled || !pipeline}
      >
        <SelectTrigger className="w-full" size={size}>
          <SelectValue placeholder="Estágio">
            {(v: string) => pipeline?.stages.find((s) => s.id === v)?.name ?? ""}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {pipeline?.stages.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
