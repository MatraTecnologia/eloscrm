"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useCreatePipeline, useUpdatePipeline } from "@/lib/queries/pipelines";
import { PIPELINE_TEMPLATES } from "@/lib/pipeline-templates";
import type { Pipeline } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const PipelineFormDialog = ({
  pipeline,
  trigger,
  onCreated,
  open: openProp,
  onOpenChange,
}: {
  pipeline?: Pipeline;
  trigger?: React.ReactNode;
  onCreated?: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const editing = !!pipeline;
  const create = useCreatePipeline();
  const update = useUpdatePipeline();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (o: boolean) => (controlled ? onOpenChange?.(o) : setOpenState(o));
  const [name, setName] = useState(pipeline?.name ?? "");
  const [templateId, setTemplateId] = useState("vendas");

  const saving = create.isPending || update.isPending;

  // reabrir não pode trazer o rascunho anterior: o state nasce na montagem e o dialog não desmonta
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(pipeline?.name ?? "");
      setTemplateId("vendas");
    }
    setOpen(next);
  };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      if (editing) {
        await update.mutateAsync({ id: pipeline.id, name: name.trim() });
        toast.success("Pipeline renomeado");
      } else {
        const template = PIPELINE_TEMPLATES.find((t) => t.id === templateId);
        const created = await create.mutateAsync({ name: name.trim(), stages: template?.stages });
        toast.success("Pipeline criado");
        onCreated?.(created.id);
      }
      setOpen(false);
    } catch {
      toast.error("Não foi possível salvar o pipeline");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement<Record<string, unknown>>} />}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Renomear pipeline" : "Novo pipeline"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pipeline-name">Nome</Label>
            <Input
              id="pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Vendas, Locação…"
            />
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label>Modelo</Label>
              <div className="grid max-h-60 gap-2 overflow-y-auto pr-1">
                {PIPELINE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      templateId === t.id ? "border-primary bg-accent" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                      {t.stages.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t.stages.map((s) => s.name).join(" → ")}
                        </div>
                      )}
                    </div>
                    {templateId === t.id && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Salvando…" : editing ? "Salvar" : "Criar pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
