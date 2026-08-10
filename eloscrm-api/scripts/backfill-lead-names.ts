/**
 * Conserta os leads que ficaram chamados pelo próprio telefone, e os cards que repetiam esse nome.
 *
 *   pnpm tsx scripts/backfill-lead-names.ts          # só mostra o que mudaria
 *   pnpm tsx scripts/backfill-lead-names.ts --apply  # grava
 *
 * Rodar uma vez por banco, depois de subir a correção da ingestão. Sem isto a correção só vale para
 * mensagem nova: quem já está no funil continua como "(43) 9841-4904" até o cliente escrever de
 * novo — e os 39 cards que a imobiliária tem na tela hoje não mudariam sozinhos.
 *
 * Faz duas coisas, ambas idempotentes e ambas com a mesma guarda — só mexe no que ainda é
 * exatamente o texto que a automação escreveu:
 *
 *  1. **Nome do lead** — quando o nome é o telefone formatado e a conversa já sabe o nome de
 *     verdade (`contactName`/`waName`, que chegam quando o cliente responde).
 *  2. **Título do negócio** — quando o título é `Atendimento — <telefone do lead>` e o lead tem
 *     nome. Cobre tanto o que este script acabou de renomear quanto o que a imobiliária já tinha
 *     renomeado à mão, sem efeito na tela.
 *
 * Não grava evento de auditoria: é correção de dado feita por operador, com o relatório abaixo como
 * registro — mesma escolha de `backfill-phone-key.ts`. O que a automação fizer daqui para frente
 * continua auditado normalmente.
 *
 * Também lista os leads criados a partir de conversa em grupo, que a ingestão passou a ignorar.
 * **Não apaga nenhum**: excluir lead leva junto negócios, atividades e anexos, e essa é uma decisão
 * de quem conhece o funil — o script só mostra o que olhar.
 */
import "dotenv/config";
import { autoDealTitle } from "../src/lib/deal-title.js";
import { formatBrPhone } from "../src/lib/phone.js";
import { prisma } from "../src/lib/prisma.js";

const apply = process.argv.includes("--apply");

const renomearLeads = async () => {
  const conversas = await prisma.conversation.findMany({
    where: { clientId: { not: null }, isGroup: false },
    select: {
      contactName: true,
      waName: true,
      client: { select: { id: true, name: true, phone: true } },
    },
  });

  const pendentes = conversas
    .map((conversa) => ({
      client: conversa.client!,
      nome: (conversa.contactName ?? conversa.waName ?? "").trim(),
    }))
    .filter(
      ({ client, nome }) =>
        nome.length > 0 && client.name !== nome && client.name === formatBrPhone(client.phone),
    );

  console.log(`\nnomes: ${pendentes.length} lead(s) chamados pelo telefone com nome disponível`);
  for (const { client, nome } of pendentes) console.log(`  ${client.name} → ${nome}`);

  if (apply) {
    for (const { client, nome } of pendentes) {
      await prisma.client.update({ where: { id: client.id }, data: { name: nome } });
    }
  }
  return new Map(pendentes.map(({ client, nome }) => [client.id, nome]));
};

/**
 * `renomeados` entra aqui para o dry-run contar o mesmo que o `--apply` faria: o card de um lead que
 * ainda vai ser renomeado nesta mesma execução também tem título a corrigir, e ler só o banco
 * mostraria um número menor do que o que seria gravado.
 */
const renomearTitulos = async (renomeados: Map<string, string>) => {
  const deals = await prisma.deal.findMany({
    select: {
      id: true,
      title: true,
      client: { select: { id: true, name: true, phone: true } },
    },
  });

  const pendentes = deals
    .map((deal) => ({
      deal,
      nome: renomeados.get(deal.client.id) ?? deal.client.name,
      telefone: formatBrPhone(deal.client.phone),
    }))
    .filter(
      ({ deal, nome, telefone }) =>
        telefone !== null && nome !== telefone && deal.title === autoDealTitle(telefone),
    );

  console.log(`\ntítulos: ${pendentes.length} card(s) ainda chamando o lead pelo telefone`);
  for (const { deal, nome } of pendentes) console.log(`  ${deal.title} → ${autoDealTitle(nome)}`);

  if (apply) {
    for (const { deal, nome } of pendentes) {
      await prisma.deal.update({ where: { id: deal.id }, data: { title: autoDealTitle(nome) } });
    }
  }
  return pendentes.length;
};

const listarLeadsDeGrupo = async () => {
  const grupos = await prisma.conversation.findMany({
    where: { isGroup: true, clientId: { not: null } },
    select: {
      waName: true,
      client: {
        select: { id: true, name: true, phone: true, _count: { select: { deals: true } } },
      },
    },
  });

  if (grupos.length === 0) return;

  console.log(`\ngrupos: ${grupos.length} lead(s) criados a partir de conversa em grupo`);
  console.log("  a ingestão não cria mais nenhum; estes ficaram e a exclusão é decisão sua");
  for (const { client, waName } of grupos) {
    const nome = client!.name;
    console.log(
      `  ${nome} (${client!.phone ?? "sem telefone"}, ${client!._count.deals} negócio(s)) — grupo "${waName ?? "?"}"`,
    );
  }
};

const run = async () => {
  const renomeados = await renomearLeads();
  const titulos = await renomearTitulos(renomeados);
  await listarLeadsDeGrupo();

  console.log(
    apply
      ? `\n${renomeados.size} lead(s) e ${titulos} título(s) atualizados.`
      : "\nnada gravado. rode com --apply para valer.",
  );
};

await run();
await prisma.$disconnect();
