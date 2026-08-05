"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, MessageCircle, Pencil, Phone, Plus, RotateCcw, Snowflake, UserPlus } from "lucide-react";
import { ClientAvatar } from "@/app/(app)/clients/client-avatar";
import { ClientDialog } from "@/app/(app)/clients/client-dialog";
import { NurtureDialog } from "@/components/app/nurture-dialog";
import { ReactivateDialog } from "@/components/app/reactivate-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { nurtureReasonLabels, phoneNationalDigits } from "@/lib/labels";
import { useClients } from "@/lib/queries/clients";
import { useMembers } from "@/lib/queries/members";
import type { Client } from "@/lib/types";
import { BUCKETS, bucketOf, type BucketKey } from "./buckets";
import { EditReasonDialog } from "./edit-reason-dialog";
import { LinkClientDialog } from "./link-client-dialog";
import { ReschedulePopover } from "./reschedule-popover";

export default function NurturingPage() {
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const { data: clients, isLoading } = useClients({ status: "NURTURING" });
  const { data: members } = useMembers();
  const hasOrg = !!org;

  // "agora" congelado na montagem, como a agenda já faz: senão o bucket de cada lead muda
  // de render em render conforme o relógio anda
  const [now] = useState(() => new Date());
  const [bucket, setBucket] = useState<BucketKey>("OVERDUE");
  const [created, setCreated] = useState<Client | null>(null);

  const memberName = (ownerId: string | null) =>
    ownerId ? (members?.find((m) => m.userId === ownerId)?.name ?? "—") : "—";

  const counts = useMemo(() => {
    const map: Record<BucketKey, number> = {
      OVERDUE: 0, WEEK: 0, MONTH: 0, LATER: 0, UNDATED: 0, ALL: clients?.length ?? 0,
    };
    for (const client of clients ?? []) map[bucketOf(client, now)] += 1;
    return map;
  }, [clients, now]);

  const filtered = (clients ?? []).filter(
    (client) => bucket === "ALL" || bucketOf(client, now) === bucket,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Nutrição</h1>
          <p className="text-muted-foreground">Leads pausados aguardando o momento certo de retomar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkClientDialog
            trigger={
              <Button variant="outline" disabled={!hasOrg}>
                <UserPlus className="size-4" /> Trazer lead existente
              </Button>
            }
          />
          <ClientDialog
            onCreated={setCreated}
            trigger={
              <Button disabled={!hasOrg}>
                <Plus className="size-4" /> Novo lead em nutrição
              </Button>
            }
          />
        </div>
      </div>

      {!loadingOrg && !hasOrg && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária para ver a nutrição.
        </div>
      )}

      {hasOrg && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {BUCKETS.map(({ key, label }) => (
              <Button
                key={key}
                type="button"
                variant={bucket === key ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={bucket === key}
                onClick={() => setBucket(key)}
              >
                {label} <span className="text-muted-foreground">{counts[key]}</span>
              </Button>
            ))}
          </div>

          {!isLoading && (clients?.length ?? 0) === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Snowflake />
                </EmptyMedia>
                <EmptyTitle>Nenhum lead em nutrição</EmptyTitle>
                <EmptyDescription>
                  Leads que ainda não estão prontos para negociar ficam aqui, pausados, até o
                  momento certo de retomar o contato — sem sumir do funil nem virar tarefa esquecida.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Parado há</TableHead>
                    <TableHead>Retomar em</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="w-40 text-right">
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
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Nenhum lead neste filtro.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((client) => {
                    const overdue = bucketOf(client, now) === "OVERDUE";
                    const digits = phoneNationalDigits(client.phone);
                    return (
                      <TableRow key={client.id} className="group">
                        <TableCell>
                          <Link href={`/clients/${client.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                            <ClientAvatar id={client.id} name={client.name} />
                            {client.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {client.nurtureReason ? nurtureReasonLabels[client.nurtureReason] : "—"}
                          {client.nurtureNote && (
                            <p className="text-xs text-muted-foreground">{client.nurtureNote}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {client.nurturedAt ? formatDistanceToNow(parseISO(client.nurturedAt), { locale: ptBR }) : "—"}
                        </TableCell>
                        <TableCell>
                          {client.nurtureUntil ? (
                            <div className="flex items-center gap-2">
                              <span>{format(parseISO(client.nurtureUntil), "dd/MM/yyyy")}</span>
                              {overdue && (
                                <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                                  Atrasado
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Sem data</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{memberName(client.ownerId)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                            {digits && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Conversar no WhatsApp"
                                nativeButton={false}
                                render={<a href={`https://wa.me/55${digits}`} target="_blank" rel="noreferrer" />}
                              >
                                <MessageCircle className="size-4 text-success" />
                              </Button>
                            )}
                            {client.phone && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Ligar"
                                nativeButton={false}
                                render={<a href={`tel:${client.phone}`} />}
                              >
                                <Phone className="size-4" />
                              </Button>
                            )}
                            <ReschedulePopover
                              client={client}
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={`Reagendar retomada de ${client.name}`}>
                                  <CalendarClock className="size-4" />
                                </Button>
                              }
                            />
                            <EditReasonDialog
                              client={client}
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={`Editar motivo de ${client.name}`}>
                                  <Pencil className="size-4" />
                                </Button>
                              }
                            />
                            <ReactivateDialog
                              client={client}
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={`Retomar contato com ${client.name}`}>
                                  <RotateCcw className="size-4" />
                                </Button>
                              }
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {created && (
        <NurtureDialog
          client={created}
          open
          onOpenChange={(next) => {
            if (!next) setCreated(null);
          }}
          onDone={() => setCreated(null)}
        />
      )}
    </div>
  );
}
