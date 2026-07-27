"use client";

import { useState } from "react";
import { usePipelines } from "@/lib/queries/pipelines";
import { useActiveOrganization } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelinePanel } from "./pipeline-panel";
import { KanbanBoard } from "./kanban-board";

export default function DealsPage() {
  const { data: pipelines, isLoading } = usePipelines();
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const [selectedId, setSelectedId] = useState<string>();

  // derivado no render: a seleção só vale se o pipeline ainda existir; senão cai no default
  const active =
    pipelines?.find((p) => p.id === selectedId) ??
    pipelines?.find((p) => p.isDefault) ??
    pipelines?.[0];

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Negociações</h1>
        <p className="text-muted-foreground">Funil de vendas por estágio.</p>
      </div>

      {!loadingOrg && !org && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária para ver o funil.
        </div>
      )}

      {!!org && isLoading && (
        <div className="flex flex-1 gap-6">
          <Skeleton className="h-full w-60" />
          <Skeleton className="h-full flex-1" />
        </div>
      )}

      {!!org && !isLoading && !!pipelines?.length && (
        <div className="flex min-h-0 flex-1 gap-6">
          <PipelinePanel pipelines={pipelines} activeId={active?.id} onSelect={setSelectedId} />
          <div className="min-w-0 flex-1">{active && <KanbanBoard pipeline={active} />}</div>
        </div>
      )}
    </div>
  );
}
