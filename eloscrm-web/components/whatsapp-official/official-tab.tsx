"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useOfficialConnections, useOfficialSyncStatus } from "@/lib/queries/whatsapp-official";
import { useHubConfig } from "@/lib/queries/whatsapp-hub";
import type { ChannelConnection, OfficialSyncRequest } from "@/lib/types";
import { HubConnect } from "./hub-connect";
import { LifecycleControls } from "./lifecycle-controls";
import { MaintenancePanel } from "./maintenance-panel";

const syncLabels: Record<OfficialSyncRequest["status"], string> = {
  pending: "Aguardando solicitação", requesting: "Solicitando à Meta", accepted: "Solicitação aceita; aguardando dados",
  receiving: "Recebendo dados", complete: "Histórico recebido e processado", declined: "Compartilhamento recusado no celular",
  failed: "Solicitação recusada", uncertain: "Resultado incerto; sem repetição automática", expired: "Prazo para solicitar expirado",
};
const connectionLabels: Record<ChannelConnection["status"], string> = { pending: "Preparando conexão", connected: "Conectado", disconnected: "Desconectado", disabled: "Desativado" };
// motivo vindo do hub (errorCode da conexão ou meta.reason da desconexão); desconhecido = genérico
const hubErrorLabels: Record<string, string> = {
  token_expired: "A autorização venceu. Conecte o número de novo.",
  offboarded: "A Meta retirou o número da integração. Ele volta sozinho se a Meta reconectar; se não voltar, fale com o suporte.",
  onboarding_incomplete: "A ativação não terminou. Conecte o número de novo.",
  meta_uninstalled: "Desconectado pelo celular ou pelo WhatsApp Manager. Conecte o número de novo.",
  meta_account_deleted: "A conta do WhatsApp foi apagada.",
};
const healthLabels: Record<string, string> = { LIMITED: "A Meta está limitando os envios deste número.", BLOCKED: "A Meta bloqueou conversas iniciadas pela empresa neste número." };
const OfficialConnection = ({ connection, canManage }: { connection: ChannelConnection; canManage: boolean }) => {
  const syncs = useOfficialSyncStatus(connection.id, canManage);
  return <section className="flex flex-col gap-3 border-t pt-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div><h3 className="font-medium">{connection.verifiedName || connection.label}</h3><p className="text-muted-foreground text-sm">{connection.displayPhoneNumber || "Número indisponível"}</p></div>
      <p className="text-sm">{connectionLabels[connection.status]}{connection.isOnBusinessApp ? " · Coexistence" : " · Cloud API"}</p>
    </div>
    {connection.hubErrorCode && connection.status === "disconnected" && <p role="alert" className="text-destructive text-sm">{hubErrorLabels[connection.hubErrorCode] ?? "A conexão precisa de atenção. Conecte o número de novo ou fale com o suporte."}</p>}
    {connection.hubHealth?.status && healthLabels[connection.hubHealth.status] && <p className="text-sm">{healthLabels[connection.hubHealth.status]}</p>}
    {canManage && syncs.isLoading && <Skeleton className="h-12" />}
    {canManage && syncs.error && <p role="alert" className="text-destructive text-sm">Não foi possível consultar a sincronização.</p>}
    {syncs.data?.map(sync => <div key={sync.id} className="text-sm">
      <p><span className="font-medium">{sync.syncType === "history" ? "Histórico" : "Contatos"}: </span>{syncLabels[sync.status]}{sync.syncType === "history" && sync.status === "receiving" ? ` (${sync.progress}%)` : ""}</p>
      {sync.lastErrorCode === "OFFICIAL_SYNC_ITEMS_PENDING" && <p className="text-destructive">Há eventos pendentes ou com falha de processamento.</p>}
      {sync.lastErrorCode === "OFFICIAL_SUBSCRIPTION_FAILED" && <p className="text-destructive">A assinatura da conta ainda não foi confirmada. A conexão será retomada automaticamente.</p>}
      {["pending", "requesting"].includes(sync.status) && <p className="text-muted-foreground">Prazo para solicitar: {new Date(sync.deadlineAt).toLocaleString("pt-BR")}</p>}
    </div>)}
    {canManage && syncs.data?.length === 0 && <p className="text-muted-foreground text-sm">Esta conexão ainda não tem pedidos de sincronização registrados.</p>}
    {canManage && <LifecycleControls connection={connection} />}
  </section>;
};

export const OfficialTab = ({ canManage }: { canManage: boolean }) => {
  const connections = useOfficialConnections();
  const config = useHubConfig(canManage);
  return <div className="flex max-w-3xl flex-col gap-5 pt-4">
    <div><h2 className="text-lg font-semibold">WhatsApp oficial</h2><p className="text-muted-foreground mt-1 text-sm">Conecte o número do WhatsApp Business para continuar usando o celular e preparar o atendimento pelo elosCRM.</p></div>
    {canManage && config.isLoading && <Skeleton className="h-10 w-64" />}
    {canManage && config.error && <p role="alert" className="text-destructive text-sm">Não foi possível consultar a configuração da conexão oficial.</p>}
    {/* sem HUB_ENABLED (M1 em produção) o onboarding próprio segue desligado: o suporte conecta */}
    {config.data?.available === false && <Alert><AlertTitle>Conexão oficial em mudança</AlertTitle><AlertDescription>A conexão de números está mudando para um novo fluxo. Para conectar ou reconectar um número, fale com o suporte.</AlertDescription></Alert>}
    {config.data?.available && <HubConnect />}
    {!canManage && <p className="text-muted-foreground text-sm">Peça ao dono ou a um gestor para conectar o WhatsApp oficial.</p>}
    <Alert><AlertTitle>Atendimento no elosCRM</AlertTitle><AlertDescription>Use Conversas para consultar o histórico e responder pelo número selecionado. Gestores consultam estimativas e consumo na aba Custos e consumo.</AlertDescription></Alert>
    {connections.isLoading && <Skeleton className="h-24" />}
    {connections.error && <p role="alert" className="text-destructive text-sm">Não foi possível consultar as conexões.</p>}
    {connections.data?.length === 0 && <p className="text-muted-foreground text-sm">Nenhum número oficial conectado nesta imobiliária.</p>}
    {connections.data?.map(connection => <OfficialConnection key={connection.id} connection={connection} canManage={canManage} />)}
    {canManage && <MaintenancePanel />}
  </div>;
};
