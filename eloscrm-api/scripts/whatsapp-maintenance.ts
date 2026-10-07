import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { backfillHistory, purgePayloads } from "../src/modules/whatsapp-maintenance/maintenance.service.js";

const args = process.argv.slice(2);
const valueOf = (flag: string) => args[args.indexOf(flag) + 1];
const orgId = args.includes("--organization") ? valueOf("--organization") : undefined;
const userId = args.includes("--user") ? valueOf("--user") : undefined;
const operation = args[0];

try {
  if (!orgId || !userId || !["history", "retention"].includes(operation ?? "")) throw new Error("Use: tsx scripts/whatsapp-maintenance.ts history|retention --organization <id> --user <gestor-id> [--apply]");
  const actor = { id: userId, name: "Manutenção WhatsApp", source: "USER" as const };
  const apply = args.includes("--apply");
  if (operation === "retention") {
    const result = await purgePayloads(orgId, apply, actor);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    let cursor: string | undefined;
    do {
      const result = await backfillHistory(orgId, { apply, cursor }, actor);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
  }
} catch {
  process.stderr.write("Manutenção não concluída. Confira a operação, os IDs da imobiliária e do gestor e a configuração do banco.\n");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
