"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useClients, useDeleteClient } from "@/lib/queries/clients";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatPhone } from "@/lib/labels";
import { useOrgDeals } from "@/lib/queries/deals";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function ClientsPage() {
  const [q, setQ] = useState("");
  // isLoading (e não isPending): sem organização ativa a query fica desabilitada e isPending
  // nunca sai de true, o que deixaria a tabela em skeleton para sempre
  const { data: clients, isLoading } = useClients(q ? { q } : undefined);
  const { deals, isLoading: loadingDeals } = useOrgDeals();
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const remove = useDeleteClient();
  const hasOrg = !!org;

  const statsByClient = useMemo(() => {
    const map = new Map<string, { count: number; hasOpen: boolean }>();
    for (const deal of deals) {
      const current = map.get(deal.clientId) ?? { count: 0, hasOpen: false };
      current.count += 1;
      if (deal.isOpen) current.hasOpen = true;
      map.set(deal.clientId, current);
    }
    return map;
  }, [deals]);

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
        <ClientDialog
          trigger={
            <Button disabled={!hasOrg}>
              <Plus className="size-4" /> Novo cliente
            </Button>
          }
        />
      </div>

      {!loadingOrg && !hasOrg && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária para ver os clientes.
        </div>
      )}

      {hasOrg && (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nome, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
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
                      Nenhum cliente ainda. Crie o primeiro.
                    </TableCell>
                  </TableRow>
                )}
                {clients?.map((client) => {
                  const stats = statsByClient.get(client.id);
                  return (
                    <TableRow key={client.id} className="group">
                      <TableCell>
                        <Link href={`/clients/${client.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                          <ClientAvatar id={client.id} name={client.name} />
                          {client.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatPhone(client.phone) || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{client.email ?? "—"}</TableCell>
                      <TableCell>
                        {loadingDeals ? <Skeleton className="h-4 w-6" /> : (stats?.count ?? 0)}
                      </TableCell>
                      <TableCell>
                        {loadingDeals ? (
                          <Skeleton className="h-5 w-20" />
                        ) : stats?.hasOpen ? (
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
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                          <ClientDialog
                            client={client}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label="Editar cliente">
                                <Pencil className="size-4" />
                              </Button>
                            }
                          />
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${client.name}`}>
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              }
                            />
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir cliente</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja excluir &quot;{client.name}&quot;? Os negócios e
                                  atividades vinculados também serão removidos. Essa ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() => handleDelete(client.id)}
                                >
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
