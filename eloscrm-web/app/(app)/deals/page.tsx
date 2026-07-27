"use client";

import { useState } from "react";
import { usePipelines } from "@/lib/queries/pipelines";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelinePanel } from "./pipeline-panel";
import { KanbanBoard } from "./kanban-board";

export default function DealsPage() {
  const { data: pipelines, isLoading } = usePipelines();
  const [selectedId, setSelectedId] = useState<string>();

  // derivado no render: a seleção só vale se o pipeline ainda existir; senão cai no default
  const active =
    pipelines?.find((p) => p.id === selectedId) ??
    pipelines?.find((p) => p.isDefault) ??
    pipelines?.[0];

  if (isLoading) {
    return (
      <div className="flex gap-6">
        <Skeleton className="h-96 w-60" />
        <Skeleton className="h-96 flex-1" />
      </div>
    );
  }

  if (!pipelines?.length) {
    return <p className="text-muted-foreground">Selecione ou crie uma imobiliária para começar.</p>;
  }

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] gap-6">
      <PipelinePanel pipelines={pipelines} activeId={active?.id} onSelect={setSelectedId} />
      <div className="min-w-0 flex-1">{active && <KanbanBoard pipeline={active} />}</div>
    </div>
  );
}
