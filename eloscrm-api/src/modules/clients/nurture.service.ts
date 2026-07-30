import { AuditAction, AuditEntity, ClientStatus, NurtureReason } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { httpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import * as deals from "../deals/deals.service.js";
import * as repo from "./clients.repo.js";
import { getById } from "./clients.service.js";
import type { NurtureInput } from "./nurture.schema.js";

// o lostReason do negócio fechado vai para o banco e para a tela; sem este mapa gravaria SEM_ORCAMENTO cru
export const NURTURE_REASON_LABELS: Record<NurtureReason, string> = {
  SEM_ORCAMENTO: "Orçamento não fecha",
  ADIADO: "Vai comprar mais para frente",
  SEM_RESPOSTA: "Sem resposta",
  COMPROU_COM_OUTRO: "Comprou com outro",
  SO_PESQUISANDO: "Só pesquisando",
  OUTRO: "Outro motivo",
};

const invalid = (code: string, message: string) => httpError(422, code, message);

const openDealsOf = (orgId: string, clientId: string) =>
  prisma.deal.findMany({
    where: { organizationId: orgId, clientId, stage: { isWon: false, isLost: false } },
    select: { id: true, pipelineId: true },
  });

export const nurture = async (orgId: string, id: string, data: NurtureInput, actor: Actor) => {
  const client = await getById(orgId, id);
  if (client.status === ClientStatus.NURTURING) {
    throw httpError(409, "ALREADY_NURTURING", "Este lead já está em nutrição");
  }

  const open = await openDealsOf(orgId, id);
  const decisions = data.deals ?? [];
  const byDealId = new Map(decisions.map((decision) => [decision.dealId, decision]));

  // validar tudo antes de escrever: falhar no meio deixaria o lead meio nutrido e negócios fechados
  // sem volta
  const uncovered = open.filter((deal) => !byDealId.has(deal.id));
  if (uncovered.length > 0) {
    throw invalid("DEALS_NOT_COVERED", "Decida o que fazer com os negócios abertos deste lead");
  }

  const openById = new Map(open.map((deal) => [deal.id, deal]));
  const toClose: { dealId: string; lostStageId: string }[] = [];
  for (const decision of decisions) {
    const deal = openById.get(decision.dealId);
    if (!deal) throw invalid("DEAL_NOT_OPEN", "Negócio não está aberto para este lead");
    if (decision.action !== "CLOSE_LOST") continue;
    if (!decision.lostStageId) throw invalid("INVALID_LOST_STAGE", "Escolha o estágio de perda");
    const stage = await prisma.stage.findFirst({
      where: {
        id: decision.lostStageId,
        organizationId: orgId,
        pipelineId: deal.pipelineId,
        isLost: true,
      },
      select: { id: true },
    });
    if (!stage) throw invalid("INVALID_LOST_STAGE", "Estágio de perda inválido para este negócio");
    toClose.push({ dealId: decision.dealId, lostStageId: decision.lostStageId });
  }

  const lostReason = data.note ?? NURTURE_REASON_LABELS[data.reason];
  for (const { dealId, lostStageId } of toClose) {
    // via deals.service: grava STAGE_CHANGED no histórico do negócio como qualquer outro movimento
    await deals.update(orgId, dealId, { stageId: lostStageId, lostReason }, actor);
  }

  const state = {
    status: ClientStatus.NURTURING,
    nurtureReason: data.reason,
    nurtureNote: data.note ?? null,
    nurtureUntil: data.until ?? null,
    // carimbo do servidor: "parado há quanto tempo" não pode ser escolhido por quem chama
    nurturedAt: new Date(),
  };

  const updated = await repo.updateNurtureState(id, state);
  await recordAudit({
    orgId,
    entityType: AuditEntity.CLIENT,
    entityId: id,
    action: AuditAction.UPDATED,
    actor,
    changes: diffFields(client, state),
  });
  return updated;
};
