import { ClientSource } from "../../generated/prisma/client.js";
import { AUTOMATION_ACTOR } from "../../lib/actor.js";
import { formatBrPhone } from "../../lib/phone.js";
import { prisma } from "../../lib/prisma.js";
import * as clients from "../clients/clients.service.js";
import * as deals from "../deals/deals.service.js";
import * as conversations from "../whatsapp/conversations.repo.js";
import { resolveOwner } from "./assignment.service.js";

export type AutomationInput = {
  orgId: string;
  conversationId: string;
  /** lead já vinculado à conversa, se houver */
  clientId: string | null;
  /** a `phoneKey` casou com mais de um lead — ver §2.1 */
  ambiguous: boolean;
  suggestedName: string | null;
  phone: string | null;
};

/**
 * O que acontece sozinho quando alguém escreve.
 *
 * Passa por três decisões independentes, na ordem: criar o lead, criar o negócio, escolher o dono.
 * Cada uma tem a própria chave, e cada `return` daqui é uma condição que **não** foi atendida —
 * silêncio é o comportamento correto quando a imobiliária não pediu automação.
 */
export const applyToConversation = async (input: AutomationInput) => {
  const config = await prisma.leadAutomation.findUnique({
    where: { organizationId: input.orgId },
  });
  if (!config) return { skipped: "sem configuração" as const };

  // A ingestão recusa vincular quando a chave casa com mais de um lead — fixo e celular colidem
  // nela. Criar um lead aqui produziria o terceiro registro do mesmo cliente: a automação não
  // resolve o que foi deliberadamente deixado para uma pessoa.
  if (input.ambiguous) return { skipped: "telefone ambíguo" as const };

  const { clientId, ownerId } = input.clientId
    ? await ownerOfExisting(input.orgId, input.clientId)
    : await createClient(input, config.autoCreateClient);

  if (!clientId) return { skipped: "criação de lead desligada" as const };

  const deal = await createDeal(input.orgId, clientId, ownerId, config);
  return { clientId, ownerId, dealId: deal?.id ?? null };
};

/**
 * Lead que já existe não passa pela roleta se tem dono — quem atende continua atendendo.
 *
 * Órfão, sim: não há trabalho a desfazer, e é justamente o lead que ninguém está olhando. Nesse
 * caso o dono sorteado é gravado também no lead, não só no negócio.
 */
const ownerOfExisting = async (orgId: string, clientId: string) => {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: orgId },
    select: { ownerId: true },
  });
  const ownerId = await resolveOwner(orgId, client?.ownerId ?? null);

  if (ownerId && !client?.ownerId) {
    await prisma.client.update({ where: { id: clientId }, data: { ownerId } });
  }
  return { clientId, ownerId };
};

const createClient = async (input: AutomationInput, enabled: boolean) => {
  if (!enabled) return { clientId: null, ownerId: null };

  const ownerId = await resolveOwner(input.orgId, null);
  const phone = formatBrPhone(input.phone);
  const client = await clients.create(
    input.orgId,
    {
      // o perfil do WhatsApp pode não ter nome; o telefone identifica melhor que "Sem nome"
      name: input.suggestedName?.trim() || phone || "Contato do WhatsApp",
      phone: phone ?? undefined,
      source: ClientSource.WHATSAPP,
      ownerId: ownerId ?? undefined,
    },
    AUTOMATION_ACTOR,
  );

  await conversations.linkClient(input.conversationId, client.id);
  return { clientId: client.id, ownerId };
};

const createDeal = async (
  orgId: string,
  clientId: string,
  ownerId: string | null,
  config: { autoCreateDeal: boolean; pipelineId: string | null; stageId: string | null },
) => {
  if (!config.autoCreateDeal || !config.pipelineId || !config.stageId) return null;

  // funil configurado pode ter sido apagado depois: sem o estágio não há onde pôr o card, e a
  // mensagem precisa entrar do mesmo jeito
  const stage = await prisma.stage.findFirst({
    where: { id: config.stageId, organizationId: orgId, pipelineId: config.pipelineId },
    select: { id: true },
  });
  if (!stage) return null;

  // sem isto, cada "bom dia" de um cliente em negociação vira um card novo, e em uma semana o
  // funil fica ilegível
  const aberto = await prisma.deal.findFirst({
    where: {
      organizationId: orgId,
      clientId,
      pipelineId: config.pipelineId,
      stage: { isWon: false, isLost: false },
    },
    select: { id: true },
  });
  if (aberto) return null;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true },
  });

  return deals.create(
    orgId,
    {
      // mesmo texto do AddToPipelineDialog: duas convenções deixariam o funil com cards de duas
      // caras conforme a origem
      title: `Atendimento — ${client.name}`,
      clientId,
      pipelineId: config.pipelineId,
      stageId: config.stageId,
      ownerId: ownerId ?? undefined,
    },
    AUTOMATION_ACTOR,
  );
};
