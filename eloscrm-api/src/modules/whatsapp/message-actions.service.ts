import { AuditAction, AuditEntity, UazapiInstanceStatus, WhatsappDirection } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { snapshotOf } from "../../lib/audit-snapshot.js";
import { conflict, notFound } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { conversationLabel } from "./conversations.service.js";
import { refreshPreview } from "./status.service.js";
import { instanceClient, requireIntegration, uazapiError } from "./whatsapp.gateway.js";

/** Durações que o WhatsApp aceita para um pin; qualquer outra o provedor troca por 30. */
export const PIN_DAYS = [1, 7, 30] as const;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Carrega a mensagem e a instância, garantindo o escopo da organização e da conversa.
 *
 * O par (conversa, mensagem) é sempre exigido junto: só o id da mensagem deixaria um id chutado
 * agir sobre a conversa de outra imobiliária.
 */
const load = async (orgId: string, conversationId: string, messageId: string) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: orgId },
    include: { instance: true, client: { select: { name: true } } },
  });
  if (!conversation) throw notFound("Conversa não encontrada");

  const message = await prisma.whatsappMessage.findFirst({
    where: { id: messageId, conversationId },
  });
  if (!message) throw notFound("Mensagem não encontrada");

  return { conversation, message };
};

const requireConnected = (status: UazapiInstanceStatus) => {
  if (status !== UazapiInstanceStatus.connected) {
    throw conflict("INSTANCE_NOT_CONNECTED", "Conecte o WhatsApp antes de agir sobre a mensagem");
  }
};

/**
 * Apaga para todos.
 *
 * **Só o que a imobiliária enviou.** A spec do provedor aceita mensagem recebida, mas no WhatsApp
 * isso é "apagar para mim": some daqui e continua no aparelho do lead. Num CRM, apagar o que o
 * cliente escreveu destrói registro de negociação com um clique — e a assimetria confundiria.
 *
 * O WhatsApp impõe uma janela de tempo para apagar; mensagem antiga é recusada pelo provedor, e o
 * erro sobe traduzido em vez de virar uma exclusão que não aconteceu do outro lado.
 */
export const remove = async (orgId: string, conversationId: string, messageId: string, actor: Actor) => {
  const { conversation, message } = await load(orgId, conversationId, messageId);
  requireConnected(conversation.instance.status);

  if (message.direction !== WhatsappDirection.outbound) {
    throw conflict("MESSAGE_NOT_DELETABLE", "Só é possível apagar mensagens enviadas por você");
  }
  if (!message.providerMessageId) {
    throw conflict("MESSAGE_NOT_DELETABLE", "Esta mensagem ainda não pode ser apagada");
  }
  if (message.deletedAt) return { deletedAt: message.deletedAt };

  const config = requireIntegration();
  const result = await instanceClient(config, conversation.instance.tokenEnc).messages.delete({
    id: message.providerMessageId,
  });
  if (!result.success) throw uazapiError(result.error);

  // o provedor ecoa a exclusão como `messages_update`; `applyDeletion` filtra `deletedAt: null`,
  // então o eco não desfaz nem duplica o que já foi marcado aqui
  const updated = await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: { deletedAt: new Date() },
  });

  // o eco do provedor NÃO conserta isto: `applyDeletion` filtra `deletedAt: null`, e a mensagem já
  // foi marcada aqui. Sem a chamada, a lista de conversas continuaria mostrando o texto apagado.
  await refreshPreview(conversationId);

  await recordAudit({
    orgId,
    entityType: AuditEntity.WHATSAPP_MESSAGE,
    entityId: message.id,
    entityLabel: conversationLabel(conversation),
    action: AuditAction.MESSAGE_DELETED,
    actor,
    context: { conversationId },
    snapshot: snapshotOf(AuditEntity.WHATSAPP_MESSAGE, updated),
  });

  return { deletedAt: updated.deletedAt };
};

/**
 * Fixa ou desafixa no WhatsApp.
 *
 * `pinnedUntil` existe porque o provedor **não avisa quando o pin expira**: sem guardar o fim, a
 * barra do topo mostraria para sempre uma mensagem que já saiu do fixado no celular.
 */
export const pin = async (
  orgId: string,
  conversationId: string,
  messageId: string,
  data: { pin: boolean; duration: number },
) => {
  const { conversation, message } = await load(orgId, conversationId, messageId);
  requireConnected(conversation.instance.status);

  if (!message.providerMessageId) {
    throw conflict("MESSAGE_NOT_PINNABLE", "Esta mensagem ainda não pode ser fixada");
  }

  const config = requireIntegration();
  const result = await instanceClient(config, conversation.instance.tokenEnc).messages.pin({
    id: message.providerMessageId,
    pin: data.pin,
    ...(data.pin ? { duration: data.duration } : {}),
  });
  if (!result.success) throw uazapiError(result.error);

  const agora = new Date();
  const updated = await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: data.pin
      ? { pinnedAt: agora, pinnedUntil: new Date(agora.getTime() + data.duration * DIA_MS) }
      : { pinnedAt: null, pinnedUntil: null },
  });
  return { pinnedAt: updated.pinnedAt, pinnedUntil: updated.pinnedUntil };
};

/**
 * Favorita — **marca do CRM, não do WhatsApp**.
 *
 * A uazapi não tem endpoint de favoritar, então isto nunca chega ao aparelho de ninguém. É uma
 * marca da imobiliária: quem favorita separa a mensagem que importa e a equipe inteira vê. Nada
 * aqui fala com o provedor, e por isso funciona mesmo com o WhatsApp desconectado.
 */
export const favorite = async (
  orgId: string,
  conversationId: string,
  messageId: string,
  favorite: boolean,
  actor: Actor,
) => {
  const { message } = await load(orgId, conversationId, messageId);

  const updated = await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: favorite
      ? { favoritedAt: new Date(), favoritedById: actor.id }
      : { favoritedAt: null, favoritedById: null },
  });
  return { favoritedAt: updated.favoritedAt };
};
