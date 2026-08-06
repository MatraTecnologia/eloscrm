import "dotenv/config";
import { AuditEntity } from "../src/generated/prisma/client.js";
import { labelOf, truncate } from "../src/lib/audit-snapshot.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Preenche `entityLabel` nos eventos gravados antes da coluna existir.
 *
 * Só resolve o que **ainda existe**: evento de item já apagado fica sem rótulo, porque o nome não
 * está em lugar nenhum — é justamente a lacuna que a coluna nova passou a evitar daqui para frente. A
 * tela cai no id truncado nesses casos.
 *
 *   pnpm audit:backfill-labels
 *   pnpm audit:backfill-labels --dry-run
 */
const LOTE = 500;

type Resolver = (ids: string[]) => Promise<Map<string, string>>;

const mapFrom = (rows: { id: string; label: string | null }[]) =>
  new Map(rows.flatMap((row) => (row.label ? [[row.id, truncate(row.label)] as const] : [])));

const RESOLVERS: Partial<Record<AuditEntity, Resolver>> = {
  [AuditEntity.CLIENT]: async (ids) =>
    mapFrom(
      (await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
        (row) => ({ id: row.id, label: row.name }),
      ),
    ),
  [AuditEntity.DEAL]: async (ids) =>
    mapFrom(
      (await prisma.deal.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map(
        (row) => ({ id: row.id, label: row.title }),
      ),
    ),
  [AuditEntity.PROPERTY]: async (ids) =>
    mapFrom(
      (await prisma.property.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map(
        (row) => ({ id: row.id, label: row.title }),
      ),
    ),
  [AuditEntity.ACTIVITY]: async (ids) =>
    mapFrom(
      (
        await prisma.activity.findMany({
          where: { id: { in: ids } },
          select: { id: true, description: true },
        })
      ).map((row) => ({ id: row.id, label: row.description })),
    ),
  [AuditEntity.PIPELINE]: async (ids) =>
    mapFrom(
      (await prisma.pipeline.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
        (row) => ({ id: row.id, label: row.name }),
      ),
    ),
  [AuditEntity.STAGE]: async (ids) =>
    mapFrom(
      (await prisma.stage.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
        (row) => ({ id: row.id, label: row.name }),
      ),
    ),
};

const main = async () => {
  const dryRun = process.argv.includes("--dry-run");
  const resumo = new Map<string, { resolvidos: number; orfaos: number }>();

  for (const [entityType, resolve] of Object.entries(RESOLVERS) as [AuditEntity, Resolver][]) {
    for (;;) {
      const eventos = await prisma.auditEvent.findMany({
        where: { entityType, entityLabel: null },
        select: { id: true, entityId: true },
        take: LOTE,
      });
      if (eventos.length === 0) break;

      const nomes = await resolve([...new Set(eventos.map((evento) => evento.entityId))]);
      const contagem = resumo.get(entityType) ?? { resolvidos: 0, orfaos: 0 };

      for (const evento of eventos) {
        const label = nomes.get(evento.entityId) ?? labelOf({});
        if (!label) {
          contagem.orfaos += 1;
          continue;
        }
        contagem.resolvidos += 1;
        if (!dryRun) {
          await prisma.auditEvent.update({ where: { id: evento.id }, data: { entityLabel: label } });
        }
      }
      resumo.set(entityType, contagem);

      // sem rótulo a achar, o próximo lote traria os mesmos eventos: o laço só avança porque quem
      // resolveu deixou de casar o filtro `entityLabel: null`
      if (dryRun || contagem.resolvidos === 0) break;
    }
  }

  for (const [entityType, contagem] of resumo) {
    console.log(
      `${entityType}: ${contagem.resolvidos} rotulado(s), ${contagem.orfaos} sem nome (item já apagado)`,
    );
  }
  if (dryRun) console.log("[dry-run] nada foi gravado");
};

main()
  .catch((error) => {
    console.error("falha no backfill de rótulos:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
