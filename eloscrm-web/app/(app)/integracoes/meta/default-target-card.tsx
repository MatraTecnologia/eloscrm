"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { useUpdateMetaSettings } from "@/lib/queries/meta";
import type { MetaIntegration } from "@/lib/types";
import { TargetSelect } from "./target-select";

/**
 * Destino padrão dos leads. Copia o estado inicial uma vez, como o `AutomationForm`: a página só
 * monta isto com os dados em mãos, e o refetch de 1 minuto não sobrescreve o que está sendo editado.
 */
export const DefaultTargetCard = ({
  integration,
  canManage,
}: {
  integration: MetaIntegration;
  canManage: boolean;
}) => {
  const [target, setTarget] = useState({
    pipelineId: integration.pipelineId ?? "",
    stageId: integration.stageId ?? "",
  });
  const save = useUpdateMetaSettings();
  const incompleto = Boolean(target.pipelineId) !== Boolean(target.stageId);
  const semDestino = !target.pipelineId && !target.stageId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destino padrão no funil</CardTitle>
        <CardDescription>
          Onde o negócio de cada lead novo é criado. Um formulário pode apontar para outro estágio na
          lista abaixo. Sem destino, o lead é criado só na lista de clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TargetSelect
          pipelineId={target.pipelineId}
          stageId={target.stageId}
          onChange={setTarget}
          disabled={!canManage}
        />
        {incompleto && (
          <p className="text-destructive flex items-center gap-1.5 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            Escolha o funil e o estágio, ou limpe os dois.
          </p>
        )}
        {semDestino && !incompleto && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            Sem destino, nenhum card entra no funil.
          </p>
        )}
        {canManage && (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={incompleto || save.isPending}
              onClick={() =>
                save.mutate(
                  { pipelineId: target.pipelineId || null, stageId: target.stageId || null },
                  {
                    onSuccess: () => toast.success("Destino salvo"),
                    onError: (err) =>
                      toast.error((err as unknown as ApiError).message ?? "Não foi possível salvar"),
                  },
                )
              }
            >
              {save.isPending ? "Salvando…" : "Salvar destino"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
