import { config } from "dotenv";

config({ path: ".env.test", override: true });

// Zera o banco de teste uma vez por run, antes de qualquer arquivo. Os arquivos rodam em paralelo
// e cada um cria a própria organização, então limpar aqui (e não em afterAll) mantém o
// paralelismo e ainda garante que resíduo de run interrompida não vaze para a próxima.
export default async () => {
  // import dinâmico: src/lib/prisma lê env.DATABASE_URL no topo do módulo e o .env.test
  // precisa estar carregado antes disso.
  const { prisma } = await import("../src/lib/prisma.js");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`truncate table ${list} restart identity cascade`);
  }
  await prisma.$disconnect();
};
