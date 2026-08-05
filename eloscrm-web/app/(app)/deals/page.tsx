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
  const [alvoDoArraste, setAlvoDoArraste] = useState<string | null>(null);

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
        // o esqueleto acompanha o layout real: no celular a lista de funis é uma faixa no topo,
        // não uma coluna de 240px
        <div className="flex flex-1 flex-col gap-4 md:flex-row md:gap-6">
          <Skeleton className="h-12 w-full md:h-full md:w-60" />
          <Skeleton className="h-full flex-1" />
        </div>
      )}

      {!!org && !isLoading && !!pipelines?.length && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-6">
          {/* o quadro avisa qual funil está sob o cartão arrastado e a lista acende o destino: os
              dois são irmãos, então quem liga um ao outro é esta página */}
          <PipelinePanel
            pipelines={pipelines}
            activeId={active?.id}
            onSelect={setSelectedId}
            dropTargetId={alvoDoArraste}
          />
          <div className="min-h-0 min-w-0 flex-1">
            {active && <KanbanBoard pipeline={active} onDropTargetChange={setAlvoDoArraste} />}
          </div>
        </div>
      )}
    </div>
  );
}
