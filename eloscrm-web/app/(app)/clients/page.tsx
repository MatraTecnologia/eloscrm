"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Snowflake, Sun, Trash2, UserRoundPen } from "lucide-react";
import { toast } from "sonner";
import { useClients, useDeleteClient, useNameFixes } from "@/lib/queries/clients";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatPhone } from "@/lib/labels";
import type { ClientListItem, ClientStatus } from "@/lib/types";
import { NurtureDialog } from "@/components/app/nurture-dialog";
import { ReactivateDialog } from "@/components/app/reactivate-dialog";
import { ClientDialog } from "./client-dialog";
import { ClientAvatar } from "./client-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_CHIPS: { key: ClientStatus | "ALL"; label: string }[] = [
  { key: "ACTIVE", label: "Ativos" },
  { key: "NURTURING", label: "Em nutrição" },
  { key: "ALL", label: "Todos" },
];

type RowAction = { kind: "nurture" | "reactivate" | "edit" | "delete"; client: ClientListItem };

// a busca dispara uma request por chave de query: sem esperar a digitação parar, "joão" viraria
// quatro requests em sequência
const SEARCH_DEBOUNCE_MS = 300;

const useDebouncedValue = <T,>(value: T, delay: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

// memo + `onAction` estável: digitar na busca re-renderiza a página, não as centenas de linhas.
// A linha só tem botões; os dialogs vivem uma vez na página e montam só quando abertos — antes cada
// linha montava três dialogs, e os de nutrição assinavam a lista inteira de negócios da org
const ClientRow = memo(({ client, onAction }: { client: ClientListItem; onAction: (action: RowAction) => void }) => {
  const hasStats = client.dealCount !== undefined;
  return (
    <TableRow className="group">
      <TableCell>
        <Link href={`/clients/${client.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
          <ClientAvatar id={client.id} name={client.name} />
          {client.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatPhone(client.phone) || "—"}</TableCell>
      <TableCell className="text-muted-foreground">{client.email ?? "—"}</TableCell>
      <TableCell>{hasStats ? client.dealCount : "—"}</TableCell>
      <TableCell>
        {client.status === "NURTURING" ? (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Snowflake className="size-3.5" /> Em nutrição
          </Badge>
        ) : !hasStats ? null : client.openDealCount ? (
          <Badge variant="outline" className="border-success/20 bg-success/10 text-success">
            Ativo
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Sem negócio
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
          {client.status === "ACTIVE" ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Enviar ${client.name} para nutrição`}
              onClick={() => onAction({ kind: "nurture", client })}
            >
              <Snowflake className="size-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Reativar ${client.name}`}
              onClick={() => onAction({ kind: "reactivate", client })}
            >
              <Sun className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Editar cliente"
            onClick={() => onAction({ kind: "edit", client })}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Excluir ${client.name}`}
            onClick={() => onAction({ kind: "delete", client })}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});
ClientRow.displayName = "ClientRow";

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const search = useDebouncedValue(q.trim(), SEARCH_DEBOUNCE_MS);
  const [status, setStatus] = useState<ClientStatus | "ALL">("ACTIVE");
  const [action, setAction] = useState<RowAction | null>(null);
  // isLoading (e não isPending): sem organização ativa a query fica desabilitada e isPending
  // nunca sai de true, o que deixaria a tabela em skeleton para sempre
  const { data: clients, isLoading } = useClients({ status, withStats: true, ...(search ? { q: search } : {}) });
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const remove = useDeleteClient();
  const { data: nameFixesData } = useNameFixes();
  const nameFixes = nameFixesData ?? [];
  const hasOrg = !!org;

  // o alvo da exclusão sobrevive ao fechamento: sem isto o nome some do alerta durante a animação
  const [deleteTarget, setDeleteTarget] = useState<ClientListItem | null>(null);
  const onAction = useCallback((next: RowAction) => {
    setAction(next);
    if (next.kind === "delete") setDeleteTarget(next.client);
  }, []);
  const closeAction = (open: boolean) => {
    if (!open) setAction(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast.success("Cliente removido");
    } catch {
      toast.error("Não foi possível remover");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-muted-foreground">Leads e contatos da imobiliária.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* só aparece quando há o que corrigir: atalho para um mutirão, não item fixo de menu */}
          {nameFixes.length > 0 && (
            <Button variant="outline" nativeButton={false} render={<Link href="/clients/nomes" />}>
              <UserRoundPen className="size-4" /> Corrigir nomes ({nameFixes.length})
            </Button>
          )}
          <ClientDialog
            trigger={
              <Button disabled={!hasOrg}>
                <Plus className="size-4" /> Novo cliente
              </Button>
            }
          />
        </div>
      </div>

      {!loadingOrg && !hasOrg && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária para ver os clientes.
        </div>
      )}

      {hasOrg && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative max-w-sm flex-1 min-w-56">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar por nome, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_CHIPS.map(({ key, label }) => (
                <Button
                  key={key}
                  type="button"
                  variant={status === key ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={status === key}
                  onClick={() => setStatus(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Negócios</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16 text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && clients?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      {search ? "Nenhum cliente encontrado para essa busca." : "Nenhum cliente ainda. Crie o primeiro."}
                    </TableCell>
                  </TableRow>
                )}
                {clients?.map((client) => (
                  <ClientRow key={client.id} client={client} onAction={onAction} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* `key` por lead: o ClientDialog inicializa o formulário na montagem */}
      {action?.kind === "edit" && (
        <ClientDialog key={action.client.id} client={action.client} open onOpenChange={closeAction} />
      )}
      {action?.kind === "nurture" && <NurtureDialog client={action.client} open onOpenChange={closeAction} />}
      {action?.kind === "reactivate" && <ReactivateDialog client={action.client} open onOpenChange={closeAction} />}
      <AlertDialog open={action?.kind === "delete"} onOpenChange={closeAction}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir &quot;{deleteTarget?.name}&quot;? Os negócios e
              atividades vinculados também serão removidos. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
