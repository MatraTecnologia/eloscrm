import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
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

  // o bucket de teste é criado aqui e não à mão: clone novo e CI sobem o S3 vazio
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  await s3
    .send(new CreateBucketCommand({ Bucket: process.env.R2_PRIVATE_BUCKET_NAME! }))
    .catch(() => null); // já existe é o caso normal a partir da segunda run

  await prisma.$disconnect();
};
