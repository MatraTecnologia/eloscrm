"use client";

import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { useUpdateMetaForm } from "@/lib/queries/meta";
import type { MetaLeadForm } from "@/lib/types";
import { TargetSelect } from "./target-select";

export const FormRow = ({ form, canManage }: { form: MetaLeadForm; canManage: boolean }) => {
  const [target, setTarget] = useState({
    pipelineId: form.pipelineId ?? "",
    stageId: form.stageId ?? "",
  });
  const update = useUpdateMetaForm();
  const onError = (err: unknown) =>
    toast.error((err as ApiError).message ?? "Não foi possível salvar");

  const dirty = target.pipelineId !== (form.pipelineId ?? "") || target.stageId !== (form.stageId ?? "");
  const incompleto = Boolean(target.pipelineId) !== Boolean(target.stageId);

  const save = (enabled: boolean) =>
    update.mutate(
      {
        id: form.id,
        enabled,
        pipelineId: target.pipelineId || null,
        stageId: target.stageId || null,
      },
      { onError },
    );

  return (
    <TableRow>
      <TableCell>
        <Switch
          checked={form.enabled}
          onCheckedChange={(on) => save(on)}
          disabled={!canManage || update.isPending || incompleto}
          aria-label={form.enabled ? "Desligar formulário" : "Ligar formulário"}
        />
      </TableCell>
      <TableCell>
        <div className="font-medium">{form.name}</div>
        <div className="text-muted-foreground text-xs">
          {form.page.name}
          {form.remoteStatus && form.remoteStatus !== "ACTIVE" && (
            <Badge variant="outline" className="ml-2">
              {form.remoteStatus.toLowerCase()}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-72">
        <TargetSelect
          pipelineId={target.pipelineId}
          stageId={target.stageId}
          onChange={setTarget}
          disabled={!canManage}
          placeholder="Padrão da integração"
          size="sm"
        />
        {incompleto && <p className="text-destructive mt-1 text-xs">Escolha os dois ou nenhum.</p>}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
        {form.leadsCount}
        {form.lastLeadAt && form.leadsCount > 0 && (
          <span className="block text-xs">
            {formatDistanceToNow(parseISO(form.lastLeadAt), { addSuffix: true, locale: ptBR })}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {canManage && dirty && (
          <Button size="sm" variant="outline" disabled={incompleto || update.isPending} onClick={() => save(form.enabled)}>
            Salvar
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};
