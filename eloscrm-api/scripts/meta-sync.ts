import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { syncAll } from "../src/modules/meta/meta.sync.service.js";

/**
 * Uma rodada da busca de leads do Meta, para ambiente sem Redis (onde o cron de 1 minuto não é
 * agendado). Em produção com REDIS_URL isto é redundante — e inofensivo, pelo @unique do lead.
 */
const main = async () => {
  const ingested = await syncAll();
  console.log(`leads do Meta ingeridos: ${ingested}`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
