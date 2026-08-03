/**
 * Marca como verificados os e-mails de todas as contas criadas ANTES de `requireEmailVerification`
 * existir. Rodar uma única vez, no banco de produção, **antes** de subir a versão com a flag ligada.
 *
 *   pnpm tsx scripts/backfill-email-verified.ts          # só lista quem seria afetado
 *   pnpm tsx scripts/backfill-email-verified.ts --apply  # grava
 *
 * Sem isso, todo usuário existente (emailVerified = false) fica trancado fora do sistema. Pior:
 * ao tentar entrar pelo código de acesso, o Better Auth trata o OTP como prova de posse do endereço
 * e **apaga a senha** da conta não verificada — a pessoa perde a senha antiga sem pedir nada.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const apply = process.argv.includes("--apply");

const main = async () => {
  const pending = await prisma.user.findMany({
    where: { emailVerified: false },
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    console.log("Nenhuma conta com e-mail pendente de verificação.");
    return;
  }

  console.log(`${pending.length} conta(s) com emailVerified = false:`);
  for (const user of pending) {
    console.log(`  ${user.email}  (criada em ${user.createdAt.toISOString().slice(0, 10)})`);
  }

  if (!apply) {
    console.log("\nSimulação. Rode de novo com --apply para gravar.");
    return;
  }

  const { count } = await prisma.user.updateMany({
    where: { emailVerified: false },
    data: { emailVerified: true },
  });
  console.log(`\n${count} conta(s) marcadas como verificadas.`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
