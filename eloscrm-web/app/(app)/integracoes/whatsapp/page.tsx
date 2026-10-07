"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useMembers } from "@/lib/queries/members";
import { useCreateWhatsappInstance, useWhatsappInstance } from "@/lib/queries/whatsapp";
import { toast } from "sonner";
import { ConnectPanel } from "./connect-panel";
import { DangerZone } from "./danger-zone";
import { DiagnosticsTab } from "./diagnostics-tab";
import { InstanceHeader } from "./instance-header";
import { LogsTab } from "./logs-tab";
import { OverviewTab } from "./overview-tab";
import { TestSendTab } from "./test-send-tab";
import { useAutoSyncProfile } from "./use-auto-sync-profile";
import { WebhookTab } from "./webhook-tab";
import { OfficialTab } from "@/components/whatsapp-official/official-tab";
import { CostDashboard } from "@/components/whatsapp-official/cost-dashboard";
import { AutomationPanel } from "@/components/whatsapp-official/automation-panel";

export default function WhatsappIntegrationPage() {
  const { data: org, isPending: loadingOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const { data: members } = useMembers();
  const { data: instance, isLoading, error } = useWhatsappInstance();
  const create = useCreateWhatsappInstance();

  const role = members?.find((member) => member.userId === session?.user.id)?.role;
  const canManage = role === "owner" || role === "admin";

  // o webhook não traz perfil; sem isto a tela fica sem foto e sem nome até alguém sincronizar
  useAutoSyncProfile(instance, canManage);

  const notConfigured = (error as { code?: string } | null)?.code === "INTEGRATION_NOT_CONFIGURED";

  return (
    <div className="flex min-w-0 flex-col gap-6 p-0 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="text-muted-foreground text-sm">
          Gerencie o WhatsApp oficial e o número usado na conexão uazapi.
        </p>
      </div>

      <Tabs defaultValue="official" className="min-w-0">
        <TabsList className="max-w-full flex-wrap group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="official">WhatsApp oficial</TabsTrigger>
          <TabsTrigger value="uazapi">uazapi</TabsTrigger>
          {canManage && <TabsTrigger value="costs">Custos e consumo</TabsTrigger>}
          {canManage && <TabsTrigger value="automations">Automações</TabsTrigger>}
        </TabsList>
        <TabsContent value="official">
          {org && <OfficialTab key={org.id} canManage={canManage} />}
        </TabsContent>
        {canManage && <TabsContent value="costs" className="min-w-0"><CostDashboard /></TabsContent>}
        {canManage && <TabsContent value="automations" className="min-w-0">{org && <AutomationPanel key={org.id} />}</TabsContent>}
        <TabsContent value="uazapi">
      {notConfigured && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Integração não configurada neste ambiente</AlertTitle>
          <AlertDescription>
            Fale com o suporte para habilitar a conexão de WhatsApp nesta instalação.
          </AlertDescription>
        </Alert>
      )}

      {(loadingOrg || isLoading) && !notConfigured && <Skeleton className="h-64 w-full" />}

      {org && !isLoading && !instance && !notConfigured && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WhatsappIcon className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Nenhum WhatsApp conectado</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Crie a conexão para esta imobiliária e leia o QR Code no celular do número de atendimento."
                : "Peça ao dono ou a um gestor da imobiliária para conectar o WhatsApp."}
            </EmptyDescription>
          </EmptyHeader>
          {canManage && (
            <Button
              onClick={() =>
                create.mutate(
                  {},
                  {
                    onSuccess: (created) => {
                      if (created.webhookConfigured === false) {
                        toast.warning("Conexão criada, mas o webhook não foi registrado. Use Reconfigurar.");
                        return;
                      }
                      toast.success("Conexão criada. Agora leia o QR Code.");
                    },
                    onError: (err: { message?: string }) =>
                      toast.error(err.message ?? "Não foi possível criar a conexão"),
                  },
                )
              }
              disabled={create.isPending}
            >
              <Plus />
              Conectar WhatsApp
            </Button>
          )}
        </Empty>
      )}

      {instance && (
        <>
          {instance.remoteDeletedAt && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Instância removida no servidor de WhatsApp</AlertTitle>
              <AlertDescription>
                Nenhuma ação funciona mais nesta conexão. Remova-a e conecte novamente.
              </AlertDescription>
            </Alert>
          )}

          <InstanceHeader instance={instance} canManage={canManage} />

          {instance.status !== "connected" && !instance.remoteDeletedAt && (
            <ConnectPanel instance={instance} canManage={canManage} />
          )}

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="webhook">Sincronização</TabsTrigger>
              {canManage && <TabsTrigger value="test">Teste</TabsTrigger>}
              {canManage && <TabsTrigger value="diagnostics">Diagnóstico</TabsTrigger>}
              <TabsTrigger value="logs">Histórico</TabsTrigger>
              {canManage && <TabsTrigger value="danger">Zona de risco</TabsTrigger>}
            </TabsList>
            <TabsContent value="overview">
              <OverviewTab instance={instance} canManage={canManage} />
            </TabsContent>
            <TabsContent value="webhook">
              <WebhookTab canManage={canManage} />
            </TabsContent>
            {canManage && (
              <TabsContent value="test">
                <TestSendTab instance={instance} />
              </TabsContent>
            )}
            {canManage && (
              <TabsContent value="diagnostics">
                <DiagnosticsTab />
              </TabsContent>
            )}
            <TabsContent value="logs">
              <LogsTab />
            </TabsContent>
            {canManage && (
              <TabsContent value="danger">
                <DangerZone removeOnly={!!instance.remoteDeletedAt} />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
