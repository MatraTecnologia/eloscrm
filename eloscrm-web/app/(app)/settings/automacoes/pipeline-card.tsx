"use client";

import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePipelines } from "@/lib/queries/pipelines";

export const PipelineCard = ({
  checked,
  onCheckedChange,
  pipelineId,
  stageId,
  onPipelineChange,
  onStageChange,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  pipelineId: string;
  stageId: string;
  onPipelineChange: (id: string) => void;
  onStageChange: (id: string) => void;
}) => {
  const { data: pipelines } = usePipelines();
  const pipeline = pipelines?.find((p) => p.id === pipelineId);
  const incompleto = checked && (!pipelineId || !stageId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Adicionar ao funil</CardTitle>
            <CardDescription>
              Cria o negócio no funil e no estágio escolhidos. Lead que volta a falar depois de meses
              também ganha um negócio novo — mas nunca dois abertos no mesmo funil.
            </CardDescription>
          </div>
          <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Funil</Label>
            <Select
              value={pipelineId}
              onValueChange={(v) => onPipelineChange(v ?? "")}
              disabled={!checked}
            >
              <SelectTrigger className="w-full">
                {/* sem a função, o Base UI mostra o cuid em vez do nome */}
                <SelectValue placeholder="Escolha o funil">
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Estágio</Label>
            <Select
              value={stageId}
              onValueChange={(v) => onStageChange(v ?? "")}
              disabled={!checked || !pipeline}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha o estágio">
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
        </div>

        {/* configuração pela metade falha em silêncio: sem o aviso, o gestor sai da tela achando
            que ligou algo que a API vai recusar */}
        {incompleto && (
          <p className="text-destructive flex items-center gap-1.5 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            Escolha o funil e o estágio antes de salvar.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
