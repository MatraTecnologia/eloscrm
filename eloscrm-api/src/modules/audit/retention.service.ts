import { AuditAction, AuditEntity } from "../../generated/prisma/client.js";
import { SYSTEM_ACTOR } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { createWorker, scheduleCron } from "../../lib/queue.js";
import { env } from "../../env.js";

export const AUDIT_RETENTION_QUEUE = "audit-retention";

/** 03:20, fora do horário comercial da imobiliária. */
const DAILY_PATTERN = "0 20 3 * * *";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Apaga eventos anteriores ao corte, em lotes.
 *
 * Em lotes porque um DELETE de milhões de linhas numa tabela com quatro índices segura a escrita
 * concorrente pelo tempo da transação — e a auditoria é escrita em **todo** request. A contagem por
 * organização é o que alimenta o evento PURGED: a purga também se audita.
 */
export const purgeOlderThan = async (cutoff: Date, batchSize = 5_000) => {
  const byOrg = new Map<string, number>();
  let removed = 0;

  for (;;) {
    const lote = await prisma.auditEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, organizationId: true },
      take: batchSize,
    });
    if (lote.length === 0) break;

    await prisma.auditEvent.deleteMany({ where: { id: { in: lote.map((e) => e.id) } } });
    for (const evento of lote) {
      byOrg.set(evento.organizationId, (byOrg.get(evento.organizationId) ?? 0) + 1);
    }
    removed += lote.length;
    if (lote.length < batchSize) break;
  }

  return { removed, byOrg };
};

export const cutoffFor = (days: number) => new Date(Date.now() - days * DIA_MS);

/**
 * Uma passada da retenção.
 *
 * O evento `PURGED` por organização é meta-auditoria de propósito: sem ele, uma tabela que encolheu
 * não tem explicação. É auto-limitado, porque essas linhas também caem na retenção seguinte.
 */
export const runRetention = async (days = env.AUDIT_RETENTION_DAYS) => {
  const { removed, byOrg } = await purgeOlderThan(cutoffFor(days));
  if (removed === 0) return 0;

  for (const [orgId, count] of byOrg) {
    await recordAudit({
      orgId,
      entityType: AuditEntity.ORGANIZATION,
      entityId: orgId,
      action: AuditAction.PURGED,
      actor: SYSTEM_ACTOR,
      changes: { removed: { from: count, to: 0 } },
      context: { retentionDays: days },
    });
  }
  return removed;
};

createWorker(AUDIT_RETENTION_QUEUE, async () => {
  await runRetention();
}, 1);

/** Chamado no boot do servidor. Sem Redis não agenda nada — ver `scheduleCron`. */
export const scheduleAuditRetention = () =>
  scheduleCron(AUDIT_RETENTION_QUEUE, "daily", DAILY_PATTERN, "America/Sao_Paulo");
