import type { WhatsappLogEvent, WhatsappStatus } from "@/lib/types";

export const statusLabels: Record<WhatsappStatus, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  hibernated: "Sessão pausada",
};

export const statusVariants: Record<WhatsappStatus, "default" | "secondary" | "outline" | "destructive"> = {
  disconnected: "outline",
  connecting: "secondary",
  connected: "default",
  hibernated: "secondary",
};

export const logEventLabels: Record<WhatsappLogEvent, string> = {
  created: "Instância criada",
  connect_requested: "Conexão solicitada",
  qr_generated: "QR Code gerado",
  paircode_generated: "Código de pareamento gerado",
  connected: "Conectado",
  disconnected: "Desconectado",
  status_changed: "Status alterado",
  reset: "Reiniciado",
  synced: "Sincronizado",
  name_updated: "Nome alterado",
  webhook_configured: "Webhook configurado",
  test_message_sent: "Mensagem de teste enviada",
  remote_deleted: "Removido no servidor",
  deleted: "Excluído",
  error: "Erro",
};

export const logSourceLabels: Record<string, string> = {
  manual: "Painel",
  webhook: "Automático",
  sync: "Sincronização",
  system: "Sistema",
};

/** owner@s.whatsapp.net -> +55 43 99914-0409 */
export const jidToPhone = (jid: string | null) => {
  const digits = jid?.split("@")[0]?.replace(/\D/g, "");
  if (!digits) return null;
  const country = digits.slice(0, 2);
  const area = digits.slice(2, 4);
  const rest = digits.slice(4);
  if (rest.length < 8) return `+${digits}`;
  return `+${country} ${area} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
};
