import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { cutoffFor, runRetention } from "../src/modules/audit/retention.service.js";
import { env } from "../src/env.js";

/**
 * Purga manual da auditoria.
 *
 * Existe porque o job diário só é agendado quando há `REDIS_URL`: em dev, em CI e numa produção sem
 * fila, este script é o único caminho da retenção — dá para pendurar no cron do host.
 *
 *   pnpm audit:purge                 # usa AUDIT_RETENTION_DAYS
 *   pnpm audit:purge --days 90
 *   pnpm audit:purge --dry-run       # conta, não apaga
 */
const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async () => {
  const days = Number(arg("days") ?? env.AUDIT_RETENTION_DAYS);
  const dryRun = process.argv.includes("--dry-run");
  const cutoff = cutoffFor(days);

  if (dryRun) {
    const total = await prisma.auditEvent.count({ where: { createdAt: { lt: cutoff } } });
    console.log(`[dry-run] ${total} evento(s) anteriores a ${cutoff.toISOString()} (${days} dias)`);
    return;
  }

  // pelo runRetention, não pelo purgeOlderThan: o evento PURGED por organização faz parte da rotina,
  // e rodar à mão não deveria deixar a tabela encolher sem explicação
  const removed = await runRetention(days);
  console.log(`${removed} evento(s) removidos (corte em ${cutoff.toISOString()}, ${days} dias)`);
};

main()
  .catch((error) => {
    console.error("falha na purga da auditoria:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
