/**
 * Conserta as mensagens ingeridas antes de a ingestão saber lê-las: contato compartilhado e
 * localização.
 *
 *   pnpm tsx scripts/backfill-message-kinds.ts          # só mostra o que mudaria
 *   pnpm tsx scripts/backfill-message-kinds.ts --apply  # grava
 *
 * Rodar uma vez por banco, depois do `prisma db push` que cria a coluna `contacts`. Sem isto, as
 * mensagens antigas continuam como `unsupported`, com o vCard resumido escrito na bolha e um
 * "Mídia indisponível: Message does not contain downloadable media" em cima — que é o que a
 * imobiliária está vendo hoje.
 *
 * A reconstrução sai do `text`, não do vCard: o cartão original não foi guardado, mas o resumo que o
 * provedor manda tem o mesmo conteúdo em formato previsível — e `rawType` diz quais linhas olhar,
 * sem depender de adivinhar pelo texto.
 *
 *     Ryan Varela
 *     X-Wa-Biz-Name: Ryan
 *     Phone: +55 43 99985-4972
 *
 * ⚠️ O telefone sai diferente do que a ingestão nova grava, e isso é do formato, não do script: o
 * vCard traz `TEL;waid=554399854972` — a forma canônica do WhatsApp, sem o nono dígito — enquanto o
 * resumo só tem o número legível (`+55 43 99985-4972`, com ele). Os dois discam para a mesma pessoa;
 * o do backfill é o que uma pessoa digitaria.
 *
 * Idempotente: quem já tem `contacts` fica de fora.
 */
import "dotenv/config";
import { Prisma, WhatsappMediaStatus, WhatsappMessageType } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

const apply = process.argv.includes("--apply");

/** Os dois `messageType` que o WhatsApp usa para contato compartilhado. */
const RAW_TYPES = ["ContactMessage", "ContactsArrayMessage"];

type Contato = { name: string; phones: string[]; business: string | null };

/**
 * Lê o resumo do provedor.
 *
 * Cada contato abre com uma linha de nome — numerada (`1. Fulano`) quando são vários — e é seguido
 * por linhas `Chave: valor` indentadas. Linha sem dois-pontos depois de um nome só pode ser outro
 * nome, e é assim que a lista se separa sem contar itens.
 */
const parseResumo = (text: string): Contato[] => {
  const contatos: Contato[] = [];

  for (const linhaBruta of text.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha) continue;

    const campo = /^([A-Za-z-]+(?:-[A-Za-z]+)*):\s*(.+)$/.exec(linha);
    const atual = contatos.at(-1);

    if (campo && atual) {
      const [, chave, valor] = campo;
      const nome = chave!.toLowerCase();
      if (nome === "phone") atual.phones.push(valor!.replace(/\D/g, ""));
      else if (nome === "x-wa-biz-name") atual.business = valor!;
      continue;
    }

    // `1. Ryan Varela` na lista, `Ryan Varela` quando é um só
    const nome = linha.replace(/^\d+\.\s*/, "").trim();
    if (nome) contatos.push({ name: nome, phones: [], business: null });
  }

  return contatos.filter((contato) => contato.phones.length > 0);
};

/**
 * Localização: só o tipo se recupera.
 *
 * As coordenadas não foram guardadas — a coluna não existia —, e não há de onde tirá-las: o `text`
 * dessas mensagens vem vazio. O que sobrou é o mapa estático em `mediaThumb`, e é o suficiente para
 * a bolha deixar de ser um retângulo em branco: o cartão mostra o mapa e diz "Localização", sem
 * link. Mensagem nova, essa sim, chega completa.
 */
const corrigirLocalizacoes = async () => {
  const mensagens = await prisma.whatsappMessage.findMany({
    where: { rawType: "LocationMessage", type: { not: WhatsappMessageType.location } },
    select: { id: true, mediaThumb: true },
  });

  console.log(`\n${mensagens.length} localização(ões) marcadas como tipo desconhecido`);
  const semMapa = mensagens.filter((mensagem) => !mensagem.mediaThumb).length;
  if (semMapa > 0) console.log(`  ${semMapa} sem o mapa estático — a bolha fica só com o rótulo`);

  if (!apply) return mensagens.length;

  await prisma.whatsappMessage.updateMany({
    where: { id: { in: mensagens.map((mensagem) => mensagem.id) } },
    data: {
      type: WhatsappMessageType.location,
      mediaStatus: WhatsappMediaStatus.none,
      mediaError: null,
    },
  });
  return mensagens.length;
};

const run = async () => {
  const mensagens = await prisma.whatsappMessage.findMany({
    where: { rawType: { in: RAW_TYPES }, contacts: { equals: Prisma.DbNull } },
    select: { id: true, text: true, type: true, mediaStatus: true, mediaError: true },
  });

  const pendentes = mensagens
    .map((mensagem) => ({ mensagem, contatos: parseResumo(mensagem.text ?? "") }))
    .filter(({ contatos }) => contatos.length > 0);

  const semTexto = mensagens.length - pendentes.length;

  console.log(`${mensagens.length} contato(s) compartilhado(s) sem tradução, ${pendentes.length} recuperáveis`);
  if (semTexto > 0) {
    console.log(`  ${semTexto} sem resumo legível — ficam como estão, não há de onde tirar os dados`);
  }
  for (const { mensagem, contatos } of pendentes.slice(0, 10)) {
    console.log(`  ${mensagem.id}: ${contatos.map((c) => `${c.name} (${c.phones[0]})`).join(", ")}`);
  }
  if (pendentes.length > 10) console.log(`  … e mais ${pendentes.length - 10}`);

  if (!apply) {
    await corrigirLocalizacoes();
    console.log("\nnada gravado. rode com --apply para valer.");
    return;
  }

  for (const { mensagem, contatos } of pendentes) {
    await prisma.whatsappMessage.update({
      where: { id: mensagem.id },
      data: {
        type: WhatsappMessageType.contact,
        contacts: contatos,
        // a tentativa de baixar o vCard falhou e deixou o erro na bolha; agora não há mídia nenhuma
        mediaStatus: WhatsappMediaStatus.none,
        mediaError: null,
      },
    });
  }
  const locais = await corrigirLocalizacoes();
  console.log(`\n${pendentes.length} contato(s) e ${locais} localização(ões) atualizados.`);
};

await run();
await prisma.$disconnect();
