"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Check, Sparkles, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatPhone } from "@/lib/labels";
import { useApplyNameFixes, useNameFixes, type ClientNameFix } from "@/lib/queries/clients";

const ORIGEM: Record<"CONTACT" | "PROFILE", string> = {
  CONTACT: "Contato salvo",
  PROFILE: "Perfil do WhatsApp",
};

export default function CorrigirNomesPage() {
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const { data: fixes, isLoading } = useNameFixes();
  const apply = useApplyNameFixes();

  // edições do usuário por cima da sugestão; o que ele digitou vence, inclusive se apagar tudo
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = fixes ?? [];
  const hasOrg = !!org;
  const nameOf = (item: ClientNameFix) => edits[item.clientId] ?? item.suggestion ?? "";

  const selecionaveis = useMemo(
    () => items.filter((item) => nameOf(item).trim().length > 0).map((item) => item.clientId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, edits],
  );
  const marcados = selecionaveis.filter((id) => selected.has(id));

  const toggle = (clientId: string, checked: boolean) =>
    setSelected((atual) => {
      const proximo = new Set(atual);
      if (checked) proximo.add(clientId);
      else proximo.delete(clientId);
      return proximo;
    });

  const enviar = async (alvos: string[]) => {
    const payload = items
      .filter((item) => alvos.includes(item.clientId))
      .map((item) => ({ clientId: item.clientId, name: nameOf(item).trim() }))
      .filter((item) => item.name.length > 0);

    if (payload.length === 0) return;

    const enviados = new Set(payload.map((item) => item.clientId));

    try {
      const { applied, results } = await apply.mutateAsync(payload);
      const pulados = results.filter((result) => result.status === "skipped").length;
      // só o que foi enviado sai do rascunho: limpar tudo apagaria os nomes já digitados nas outras
      // linhas, e salvar uma linha não pode custar o trabalho feito nas demais
      setSelected((atual) => new Set([...atual].filter((id) => !enviados.has(id))));
      setEdits((atual) =>
        Object.fromEntries(Object.entries(atual).filter(([id]) => !enviados.has(id))),
      );
      toast.success(
        applied === 1 ? "1 nome corrigido" : `${applied} nomes corrigidos`,
        pulados > 0
          ? { description: `${pulados} sem alteração — já estavam com esse nome.` }
          : undefined,
      );
    } catch {
      toast.error("Não foi possível salvar os nomes");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 text-muted-foreground"
            nativeButton={false}
            render={<Link href="/clients" />}
          >
            <ArrowLeft className="size-4" /> Leads
          </Button>
          <h1 className="text-2xl font-semibold">Corrigir nomes</h1>
          <p className="max-w-2xl text-muted-foreground">
            Quando é a imobiliária que manda a primeira mensagem, o WhatsApp ainda não sabe o nome da
            pessoa e o lead entra chamado pelo próprio telefone. Assim que o cliente responde, o nome
            aparece aqui — confirme e ele vai junto para os cards do funil.
          </p>
        </div>
        {items.length > 0 && (
          <Button
            onClick={() => enviar(marcados.length > 0 ? marcados : selecionaveis)}
            disabled={apply.isPending || selecionaveis.length === 0}
          >
            <Check className="size-4" />
            {marcados.length > 0
              ? `Aplicar ${marcados.length} selecionado${marcados.length > 1 ? "s" : ""}`
              : `Aplicar todos (${selecionaveis.length})`}
          </Button>
        )}
      </div>

      {!loadingOrg && !hasOrg && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária para corrigir os nomes.
        </div>
      )}

      {hasOrg && isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((linha) => (
            <Skeleton key={linha} className="h-14 w-full" />
          ))}
        </div>
      )}

      {hasOrg && !isLoading && items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundCheck />
            </EmptyMedia>
            <EmptyTitle>Nenhum nome para corrigir</EmptyTitle>
            <EmptyDescription>
              Todos os leads estão com nome de gente. Quando algum entrar só com o telefone, ele
              aparece aqui.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {hasOrg && !isLoading && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Selecionar todos com nome preenchido"
                    checked={selecionaveis.length > 0 && marcados.length === selecionaveis.length}
                    onCheckedChange={(checked) =>
                      setSelected(checked === true ? new Set(selecionaveis) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="min-w-56">Nome</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Cards</TableHead>
                <TableHead>Última mensagem</TableHead>
                <TableHead className="w-24 text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const valor = nameOf(item);
                const pronto = valor.trim().length > 0;

                return (
                  <TableRow key={item.clientId}>
                    <TableCell>
                      <Checkbox
                        aria-label={`Selecionar ${item.currentName}`}
                        disabled={!pronto}
                        checked={selected.has(item.clientId)}
                        onCheckedChange={(checked) => toggle(item.clientId, checked === true)}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/clients/${item.clientId}`}
                        className="font-medium hover:underline"
                      >
                        {item.currentName}
                      </Link>
                      {item.phone && item.phone !== item.currentName && (
                        <div className="text-sm text-muted-foreground">
                          {formatPhone(item.phone)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Nome para ${item.currentName}`}
                        placeholder="Digite o nome"
                        value={valor}
                        onChange={(event) =>
                          setEdits((atual) => ({ ...atual, [item.clientId]: event.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {item.source ? (
                        <Badge variant="secondary" className="gap-1">
                          <Sparkles className="size-3" />
                          {ORIGEM[item.source]}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          o cliente ainda não respondeu
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.deals > 0 ? item.deals : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.lastMessageAt
                        ? formatDistanceToNow(parseISO(item.lastMessageAt), {
                            addSuffix: true,
                            locale: ptBR,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!pronto || apply.isPending}
                        onClick={() => enviar([item.clientId])}
                      >
                        Salvar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
