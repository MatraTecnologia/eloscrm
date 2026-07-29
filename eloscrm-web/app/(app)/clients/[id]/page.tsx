"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Archive, Plus, User } from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useClient } from "@/lib/queries/clients";
import { useProperties } from "@/lib/queries/properties";
import { useMembers } from "@/lib/queries/members";
import { formatCurrency } from "@/lib/labels";
import type { Activity } from "@/lib/types";
import { useOrgDeals } from "@/lib/queries/deals";
import { useClientActivities } from "./use-client-activities";
import { LeadHeader } from "./lead-header";
import { InterestProperties } from "./interest-properties";
import { ActivityTimeline } from "./activity-timeline";
import { AuditFeed } from "./audit-feed";
import { ActivityIcon } from "@/components/app/activity-visuals";
import { ActivityDialog } from "@/components/app/activity-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  // isLoading e não isPending: sem organização ativa as queries ficam desabilitadas e isPending
  // continua true para sempre, prendendo a página em skeleton
  const { data: client, isLoading } = useClient(id);
  const { deals, isLoading: loadingDeals } = useOrgDeals();
  const { data: activities, isLoading: loadingActivities } = useClientActivities(id);
  const { data: properties, isLoading: loadingProperties } = useProperties();
  const { data: members } = useMembers();
  const owner = members?.find((member) => member.userId === client?.ownerId) ?? null;

  const clientDeals = deals.filter((d) => d.clientId === id);
  const primaryDeal =
    [...clientDeals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).find((d) => d.isOpen) ??
    clientDeals[0] ??
    null;

  const interestProperty = properties?.find((p) => p.id === primaryDeal?.propertyId) ?? null;
  const budget = formatCurrency(primaryDeal?.value);

  const linkedPropertyIds = new Set(clientDeals.map((d) => d.propertyId).filter((pid): pid is string => !!pid));
  const linkedProperties = (properties ?? []).filter((p) => linkedPropertyIds.has(p.id));
  const propertiesReady = !loadingProperties && !loadingDeals;
  const hasLinkedProperties = propertiesReady && linkedProperties.length > 0;
  const isFallback = propertiesReady && linkedProperties.length === 0;
  const interestList = hasLinkedProperties
    ? linkedProperties
    : (properties ?? []).filter((p) => p.status === "DISPONIVEL").slice(0, 3);

  const allActivities = activities ?? [];
  const visitActivities = allActivities.filter((a) => a.type === "VISIT");
  const proposalActivities = allActivities.filter((a) => a.type === "PROPOSAL");

  const lastActivity =
    allActivities
      .filter((a): a is Activity & { doneAt: string } => !!a.doneAt)
      .sort((a, b) => new Date(b.doneAt).getTime() - new Date(a.doneAt).getTime())[0] ?? null;

  // "agora" congelado na montagem: chamar Date.now() no render torna o resultado instável entre renders
  const [now] = useState(() => Date.now());
  const nextAction =
    allActivities
      .filter((a): a is Activity & { dueAt: string } => !!a.dueAt && !a.doneAt && new Date(a.dueAt).getTime() > now)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null;

  if (isLoading || loadingDeals || loadingProperties) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!client) {
    return <p className="text-muted-foreground">Cliente não encontrado.</p>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/clients" />}>
        <ArrowLeft className="size-4" /> Voltar
      </Button>

      <LeadHeader
        client={client}
        stageName={primaryDeal?.stageName ?? null}
        interest={interestProperty?.type ?? null}
        budget={budget}
      />

      <Tabs defaultValue="resumo">
        <TabsList variant="line">
          <TabsTrigger value="resumo" className="data-active:text-primary after:bg-primary">
            Resumo
          </TabsTrigger>
          <TabsTrigger value="atividades" className="data-active:text-primary after:bg-primary">
            Atividades
          </TabsTrigger>
          <TabsTrigger value="visitas" className="data-active:text-primary after:bg-primary">
            Visitas
          </TabsTrigger>
          <TabsTrigger value="propostas" className="data-active:text-primary after:bg-primary">
            Propostas
          </TabsTrigger>
          <TabsTrigger value="arquivos" className="data-active:text-primary after:bg-primary">
            Arquivos
          </TabsTrigger>
          <TabsTrigger value="historico" className="data-active:text-primary after:bg-primary">
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">Última atividade</p>
                {loadingActivities ? (
                  <Skeleton className="h-9 w-full" />
                ) : lastActivity ? (
                  <div className="flex items-center gap-2.5">
                    <ActivityIcon type={lastActivity.type} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{lastActivity.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(parseISO(lastActivity.doneAt), { locale: ptBR, addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma atividade concluída.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">Próxima ação</p>
                {loadingActivities ? (
                  <Skeleton className="h-9 w-full" />
                ) : nextAction ? (
                  <div className="flex items-center gap-2.5">
                    <ActivityIcon type={nextAction.type} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{nextAction.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(nextAction.dueAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma ação agendada.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">Responsável</p>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <User className="size-4" />
                  </span>
                  <p className="text-sm">{owner?.name ?? "Sem responsável"}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Observações</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* whitespace-pre-line: observações vêm de textarea e podem ter quebras de linha */}
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {client.notes || "Sem observações registradas."}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Linha do tempo</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityTimeline activities={allActivities} isLoading={loadingActivities} limit={5} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{isFallback ? "Imóveis disponíveis" : "Imóveis de interesse"}</CardTitle>
              </CardHeader>
              <CardContent>
                <InterestProperties properties={interestList} isFallback={isFallback} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="atividades" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Atividades</CardTitle>
              {/* CardAction e não flex solto: o CardHeader é grid e só abre a segunda coluna
                  quando encontra um filho com data-slot=card-action */}
              <CardAction>
                <ActivityDialog
                  defaultClientId={client.id}
                  trigger={
                    <Button size="sm">
                      <Plus className="size-4" /> Registrar atividade
                    </Button>
                  }
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              <ActivityTimeline activities={allActivities} isLoading={loadingActivities} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visitas" className="mt-4">
          <Card>
            <CardContent>
              <ActivityTimeline
                activities={visitActivities}
                isLoading={loadingActivities}
                emptyMessage="Nenhuma visita registrada."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="propostas" className="mt-4">
          <Card>
            <CardContent>
              <ActivityTimeline
                activities={proposalActivities}
                isLoading={loadingActivities}
                emptyMessage="Nenhuma proposta registrada."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="arquivos" className="mt-4">
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Archive />
              </EmptyMedia>
              <EmptyTitle>Nenhum arquivo</EmptyTitle>
              <EmptyDescription>Os arquivos enviados para este cliente vão aparecer aqui.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de alterações</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditFeed entityType="CLIENT" entityId={client.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
