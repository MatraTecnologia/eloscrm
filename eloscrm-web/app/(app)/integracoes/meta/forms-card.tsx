"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSyncMetaForms } from "@/lib/queries/meta";
import type { MetaIntegration } from "@/lib/types";
import { FormRow } from "./form-row";

export const FormsCard = ({
  integration,
  canManage,
}: {
  integration: MetaIntegration;
  canManage: boolean;
}) => {
  const syncForms = useSyncMetaForms();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Formulários</CardTitle>
            <CardDescription>
              Ligue os formulários que devem entrar no CRM. A busca roda a cada minuto e traz só o que
              chegar depois de ligar — o histórico anterior fica no Meta.
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              disabled={syncForms.isPending}
              onClick={() =>
                syncForms.mutate(undefined, {
                  onSuccess: (data) => toast.success(`${data.forms.length} formulário(s) encontrado(s)`),
                  onError: (err: { message?: string }) => toast.error(err.message ?? "Falha ao atualizar"),
                })
              }
            >
              {syncForms.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw />}
              Atualizar lista
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {integration.forms.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum formulário de cadastro encontrado nas páginas deste token
            {integration.pages.length > 0 && ` (${integration.pages.map((p) => p.name).join(", ")})`}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Ativo</TableHead>
                  <TableHead>Formulário</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {integration.forms.map((form) => (
                  <FormRow key={form.id} form={form} canManage={canManage} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
