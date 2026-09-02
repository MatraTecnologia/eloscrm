"use client";

import { TriangleAlert } from "lucide-react";
import { MetaIcon } from "@/components/icons/meta";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useMembers } from "@/lib/queries/members";
import { useMetaIntegration } from "@/lib/queries/meta";
import { ConnectCard } from "./connect-card";
import { DefaultTargetCard } from "./default-target-card";
import { FormsCard } from "./forms-card";
import { IntegrationHeader } from "./integration-header";
import { LeadsCard } from "./leads-card";

export default function MetaIntegrationPage() {
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const { data: members } = useMembers();
  const { data: integration, isLoading, error } = useMetaIntegration();

  const role = members?.find((member) => member.userId === session?.user.id)?.role;
  const canManage = role === "owner" || role === "admin";
  const notConfigured = (error as { code?: string } | null)?.code === "INTEGRATION_NOT_CONFIGURED";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Meta Lead Ads</h1>
        <p className="text-muted-foreground text-sm">
          Leads dos formulários de cadastro do Facebook e Instagram entram sozinhos no funil, a cada
          minuto.
        </p>
      </div>

      {notConfigured && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Integração não configurada neste ambiente</AlertTitle>
          <AlertDescription>Fale com o suporte para habilitar a conexão com o Meta nesta instalação.</AlertDescription>
        </Alert>
      )}

      {(loadingOrg || isLoading) && !notConfigured && <Skeleton className="h-64 w-full" />}

      {org && !isLoading && !integration && !notConfigured && (
        <>
          {canManage ? (
            <ConnectCard />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MetaIcon className="size-6" />
                </EmptyMedia>
                <EmptyTitle>Nenhuma conta do Meta conectada</EmptyTitle>
                <EmptyDescription>
                  Peça ao dono ou a um gestor da imobiliária para conectar a conta de anúncios.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </>
      )}

      {integration && (
        <>
          {integration.status === "token_invalid" && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>O Meta recusou o token</AlertTitle>
              <AlertDescription>
                A busca de leads está parada. Gere um token novo e salve abaixo.
                {integration.lastError && ` Detalhe: ${integration.lastError}`}
              </AlertDescription>
            </Alert>
          )}
          {integration.status === "active" && integration.lastError && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>A última busca falhou</AlertTitle>
              <AlertDescription>{integration.lastError}</AlertDescription>
            </Alert>
          )}

          <IntegrationHeader integration={integration} canManage={canManage} />
          {/* key: o refetch de 1 minuto não deve sobrescrever a edição, mas salvar (que muda updatedAt)
              precisa remontar com o valor persistido */}
          <DefaultTargetCard key={integration.updatedAt} integration={integration} canManage={canManage} />
          <FormsCard integration={integration} canManage={canManage} />
          <LeadsCard />
        </>
      )}
    </div>
  );
}
