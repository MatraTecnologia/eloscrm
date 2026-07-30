import { AuditAction, AuditEntity, ClientStatus, NurtureReason } from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { diffFields, recordAudit } from "../../lib/audit.js";
import { httpError } from "../../lib/http-error.js";
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

export const nurture = async (orgId: string, id: string, data: NurtureInput, actor: Actor) => {
  const client = await getById(orgId, id);
  if (client.status === ClientStatus.NURTURING) {
    throw httpError(409, "ALREADY_NURTURING", "Este lead já está em nutrição");
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
