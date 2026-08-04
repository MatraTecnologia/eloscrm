/**
 * Preenche `Client.phoneKey` nos leads criados ANTES da coluna existir.
 *
 *   pnpm tsx scripts/backfill-phone-key.ts          # só mostra o que mudaria
 *   pnpm tsx scripts/backfill-phone-key.ts --apply  # grava
 *
 * Sem isso, todo lead já cadastrado fica com a chave nula e **nunca casa** com a conversa de
 * WhatsApp que chegar do número dele — o corretor veria "criar lead" para quem já é cliente há
 * meses. Rodar uma vez por banco, depois do `prisma db push` que cria a coluna.
 *
 * Idempotente: recalcula a chave a partir do `phone` e só escreve quando o valor difere.
 */
import "dotenv/config";
import { phoneKey } from "../src/lib/phone.js";
import { prisma } from "../src/lib/prisma.js";

const apply = process.argv.includes("--apply");

const run = async () => {
  const clients = await prisma.client.findMany({
    select: { id: true, name: true, phone: true, phoneKey: true },
  });

  const pending = clients
    .map((client) => ({ client, key: phoneKey(client.phone) }))
    .filter(({ client, key }) => key !== client.phoneKey);

  const semTelefone = pending.filter(({ key }) => key === null).length;

  console.log(`${clients.length} leads no banco, ${pending.length} a atualizar`);
  if (semTelefone) {
    console.log(`  ${semTelefone} sem telefone utilizável — a chave fica nula, e é o correto`);
  }

  for (const { client, key } of pending.slice(0, 10)) {
    console.log(`  ${client.name}: ${client.phone ?? "(sem telefone)"} → ${key ?? "null"}`);
  }
  if (pending.length > 10) console.log(`  … e mais ${pending.length - 10}`);

  if (!apply) {
    console.log("\nnada gravado. rode com --apply para valer.");
    return;
  }

  // um update por linha: são poucos registros e assim o log acima corresponde ao que foi escrito
  for (const { client, key } of pending) {
    await prisma.client.update({ where: { id: client.id }, data: { phoneKey: key } });
  }
  console.log(`\n${pending.length} leads atualizados.`);
};

await run();
await prisma.$disconnect();
