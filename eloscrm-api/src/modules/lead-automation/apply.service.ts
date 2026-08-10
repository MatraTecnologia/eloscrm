import { ClientSource, ClientStatus } from "../../generated/prisma/client.js";
import { AUTOMATION_ACTOR } from "../../lib/actor.js";
import { autoDealTitle } from "../../lib/deal-title.js";
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
  isGroup: boolean;
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

  // Grupo não é lead. O `chat.phone` de um grupo não é o telefone de ninguém — em produção veio o
  // número da própria instância —, e o nome é o do grupo: "Sonho do apartamento" e o grupo de
  // alertas da própria empresa viraram card no funil, dois deles apontando para a corretora.
  // Conversa de grupo é registrada e fica visível na tela de conversas; virar lead, não.
  if (input.isGroup) return { skipped: "conversa em grupo" as const };

  // A ingestão recusa vincular quando a chave casa com mais de um lead — fixo e celular colidem
  // nela. Criar um lead aqui produziria o terceiro registro do mesmo cliente: a automação não
  // resolve o que foi deliberadamente deixado para uma pessoa.
  if (input.ambiguous) return { skipped: "telefone ambíguo" as const };

  if (input.clientId) await renameIfAutoNamed(input.orgId, input.clientId, input.suggestedName);

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

/**
 * Corrige o lead que a automação batizou com o próprio telefone.
 *
 * Quem escreve primeiro é quem dá o nome. Se a conversa partiu da corretora, o chat ainda não existe
 * do lado do provedor e o envelope não traz nome nenhum — o telefone é o melhor que há, e foi o que
 * aconteceu em 28 dos 29 leads sem nome que a produção mostrou em 2026-08-10. O nome só chega quando
 * o cliente responde, e sem isto ele ficava parado na conversa enquanto a ficha e o card do funil
 * continuavam chamando a pessoa de "(43) 9841-4904".
 *
 * A guarda é o próprio telefone: renomeia só enquanto o nome for exatamente o que a automação
 * escreveu. Nome digitado por gente nunca é sobrescrito, e a condição deixa de valer no primeiro
 * acerto — não há update a cada mensagem.
 *
 * **Nunca use o `senderName` da mensagem como fonte.** Em mensagem da própria corretora ele é o
 * perfil da instância, não o do contato: os 2431 envios da instância observados em produção traziam
 * um único valor, o nome da imobiliária. Cair nele batizaria todo lead de primeiro contato com o
 * nome da própria empresa.
 */
const renameIfAutoNamed = async (orgId: string, clientId: string, suggested: string | null) => {
  const name = suggested?.trim();
  if (!name) return;

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: orgId },
    select: { name: true, phone: true },
  });
  if (!client || client.name === name || client.name !== formatBrPhone(client.phone)) return;

  await clients.update(orgId, clientId, { name }, AUTOMATION_ACTOR);
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

  // Sem isto, cada "bom dia" de um cliente em negociação vira um card novo, e em uma semana o
  // funil fica ilegível.
  //
  // A busca é por **qualquer** negócio, em qualquer funil e em qualquer estágio — não só pelos
  // abertos. Filtrar por `isWon`/`isLost` falsos parecia equivalente a "ainda em atendimento", mas
  // não é: em produção a imobiliária marcou "APROVADO" como ganho e "FECHADO" como perdido, que no
  // processo dela são etapas do meio, não fim de relacionamento. O negócio ficava invisível para
  // esta guarda e cada mensagem do cliente criava outro card em "Novo lead" — foi o que a fez
  // limpar o funil à mão e ver tudo duplicar de novo em minutos. Como o significado das flags é
  // escolha de cada imobiliária, nenhuma regra apoiada nelas se sustenta aqui.
  //
  // A exceção é a nutrição, e é ela que preserva o "sumiu por meses e voltou a falar" da §2.2:
  // `NURTURING` é o registro explícito, feito por uma pessoa, de que o lead esfriou — nutrir exige
  // fechar antes todos os negócios abertos. Sinal declarado vale mais que prazo arbitrário.
  const existente = await prisma.deal.findFirst({
    where: {
      organizationId: orgId,
      clientId,
      client: { status: { not: ClientStatus.NURTURING } },
    },
    select: { id: true },
  });
  if (existente) return null;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true },
  });

  return deals.create(
    orgId,
    {
      // mesmo texto do AddToPipelineDialog: duas convenções deixariam o funil com cards de duas
      // caras conforme a origem
      title: autoDealTitle(client.name),
      clientId,
      pipelineId: config.pipelineId,
      stageId: config.stageId,
      ownerId: ownerId ?? undefined,
    },
    AUTOMATION_ACTOR,
  );
};
