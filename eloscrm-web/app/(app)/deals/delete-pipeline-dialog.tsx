"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeals } from "@/lib/queries/deals";
import { useDeletePipeline, usePipelineDeletionPreview } from "@/lib/queries/pipelines";
import type { Pipeline, PipelineDeletionPreview } from "@/lib/types";
import { TransferPipelineDialog } from "./transfer-pipeline-dialog";

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

/**
 * Por que não dá para excluir, e o que fazer a respeito.
 *
 * As duas recusas do servidor pedem ações diferentes — negócio se transfere ou se fecha, "único
 * funil" se resolve criando outro —, e é isso que um toast de uma linha não conseguia dizer.
 */
const Impedimentos = ({ preview }: { preview: PipelineDeletionPreview }) => {
  const temNegocios = preview.deals.total > 0;
  const ultimo = preview.totalPipelines <= 1;

  return (
    <div className="space-y-4 text-sm">
      {temNegocios && (
        <div className="space-y-2">
          <p>
            Este funil tem <span className="font-medium">{plural(preview.deals.total, "negócio", "negócios")}</span>
            {preview.deals.open > 0 && preview.deals.closed > 0 && (
              <>
                {" "}
                ({preview.deals.open} em aberto e {preview.deals.closed} já{" "}
                {preview.deals.closed === 1 ? "fechado" : "fechados"})
              </>
            )}
            . Excluir levaria o histórico deles junto, então o servidor recusa.
          </p>
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-5">
            {preview.dealsByStage.map((linha) => (
              <li key={linha.stage}>
                {linha.stage}: {plural(linha.count, "negócio", "negócios")}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Transfira os negócios para outro funil — eles mantêm o histórico e a transferência fica
            registrada — ou feche os que já morreram antes de excluir.
          </p>
        </div>
      )}

      {ultimo && (
        <p>
          Este é o único funil da imobiliária, e o kanban precisa de pelo menos um. Crie o próximo
          antes de excluir este.
        </p>
      )}
    </div>
  );
};

export const DeletePipelineDialog = ({
  pipeline,
  open,
  onOpenChange,
}: {
  pipeline: Pipeline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [transferindo, setTransferindo] = useState(false);
  const { data: preview, isLoading } = usePipelineDeletionPreview(open ? pipeline.id : null);
  // só para alimentar a transferência em lote, que trabalha sobre os negócios em si
  const { data: deals } = useDeals(open && (preview?.deals.total ?? 0) > 0 ? pipeline.id : undefined);
  const remove = useDeletePipeline();

  const excluir = () =>
    remove.mutate(pipeline.id, {
      onSuccess: () => {
        toast.success(`Funil ${pipeline.name} excluído`);
        onOpenChange(false);
      },
      onError: (error: { message?: string }) =>
        toast.error(error.message ?? "Não foi possível excluir o funil"),
    });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview && !preview.canDelete && <AlertTriangle className="text-destructive size-4" />}
              {preview?.canDelete === false ? "Não é possível excluir agora" : `Excluir ${pipeline.name}?`}
            </DialogTitle>
            <DialogDescription>
              {preview?.canDelete === false
                ? "O funil continua como está até você resolver o que está pendente."
                : "Os estágios do funil vão junto, e não é possível desfazer."}
            </DialogDescription>
          </DialogHeader>

          {isLoading || !preview ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : preview.canDelete ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                O funil está vazio — nenhum negócio será afetado.
              </p>
              <p>
                Serão apagados{" "}
                <span className="font-medium">{plural(preview.stages.length, "estágio", "estágios")}</span>:{" "}
                <span className="text-muted-foreground">{preview.stages.join(" → ")}</span>
              </p>
            </div>
          ) : (
            <Impedimentos preview={preview} />
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Fechar</Button>} />

            {preview && !preview.canDelete && preview.deals.total > 0 && (
              <Button onClick={() => setTransferindo(true)} disabled={!deals?.length}>
                <ArrowRightLeft className="size-4" />
                Transferir os negócios
              </Button>
            )}

            {preview?.canDelete && (
              <Button variant="destructive" disabled={remove.isPending} onClick={excluir}>
                {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Excluir funil
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* o mesmo diálogo que o kanban usa na seleção múltipla: as regras da transferência ficam num
          lugar só, no servidor, e aqui ela já vem com todos os negócios do funil selecionados */}
      <TransferPipelineDialog
        deals={deals ?? []}
        currentPipelineId={pipeline.id}
        open={transferindo}
        onOpenChange={setTransferindo}
        onTransferred={() => {
          setTransferindo(false);
          // fecha o diálogo de exclusão: com o funil vazio, o gestor reabre e conclui
          onOpenChange(false);
        }}
      />
    </>
  );
};
