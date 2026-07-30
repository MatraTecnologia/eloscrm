"use client";

import { useState } from "react";
import type { Stage } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DealForm } from "./deal-form";

/** Criação fica enxuta: abas de arquivo, comentário e histórico não fazem sentido antes do registro
 * existir. Editar acontece no DealDetailDialog. */
export const DealFormDialog = ({
  pipelineId,
  stages,
  defaultStageId,
  trigger,
}: {
  pipelineId: string;
  stages: Stage[];
  defaultStageId?: string;
  trigger: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo negócio</DialogTitle>
        </DialogHeader>
        {/* o portal do Base UI não fica montado com o dialog fechado: o formulário nasce limpo a
            cada abertura sem precisar de reset explícito */}
        <DealForm
          pipelineId={pipelineId}
          stages={stages}
          defaultStageId={defaultStageId}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
};
