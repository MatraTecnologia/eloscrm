"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpdateLeadAutomation } from "@/lib/queries/lead-automation";
import type { ApiError } from "@/lib/api";
import type { LeadAutomation } from "@/lib/types";
import { CreateLeadCard } from "./create-lead-card";
import { PipelineCard } from "./pipeline-card";
import { RouletteCard } from "./roulette-card";

/**
 * Recebe a configuração já carregada e a copia para o estado local uma única vez.
 *
 * A página monta este componente só quando os dados chegam, então não há efeito sincronizando
 * estado — é o padrão que o resto do projeto segue. Refetch em segundo plano também não sobrescreve
 * o que o gestor está editando.
 */
export const AutomationForm = ({ inicial }: { inicial: LeadAutomation }) => {
  const [autoCreateClient, setAutoCreateClient] = useState(inicial.autoCreateClient);
  const [autoCreateDeal, setAutoCreateDeal] = useState(inicial.autoCreateDeal);
  const [pipelineId, setPipelineId] = useState(inicial.pipelineId ?? "");
  const [stageId, setStageId] = useState(inicial.stageId ?? "");
  const [autoAssign, setAutoAssign] = useState(inicial.autoAssign);
  const [ativos, setAtivos] = useState<string[]>(
    inicial.members.filter((m) => m.active).map((m) => m.userId),
  );

  const salvar = useUpdateLeadAutomation();

  const submit = () =>
    salvar.mutate(
      {
        autoCreateClient,
        autoCreateDeal,
        pipelineId: pipelineId || null,
        stageId: stageId || null,
        autoAssign,
        memberUserIds: ativos,
      },
      {
        onSuccess: () => toast.success("Automação salva"),
        onError: (err) => {
          const erro = err as unknown as ApiError;
          toast.error(erro.message ?? "Não foi possível salvar");
        },
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <CreateLeadCard checked={autoCreateClient} onCheckedChange={setAutoCreateClient} />

      <PipelineCard
        checked={autoCreateDeal}
        onCheckedChange={setAutoCreateDeal}
        pipelineId={pipelineId}
        stageId={stageId}
        onPipelineChange={(id) => {
          setPipelineId(id);
          setStageId("");
        }}
        onStageChange={setStageId}
      />

      <RouletteCard
        checked={autoAssign}
        onCheckedChange={setAutoAssign}
        members={inicial.members}
        ativos={ativos}
        onToggle={(userId, on) =>
          setAtivos((atual) =>
            on ? [...atual, userId] : atual.filter((id) => id !== userId),
          )
        }
      />

      <div className="flex justify-end">
        <Button onClick={submit} disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando…" : "Salvar automação"}
        </Button>
      </div>
    </div>
  );
};
