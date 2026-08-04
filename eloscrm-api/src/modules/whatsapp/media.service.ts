import { Readable } from "node:stream";
import type { ReadableStream as StreamWebReadable } from "node:stream/web";

import { WhatsappMediaStatus } from "../../generated/prisma/client.js";
import { decryptToken } from "../../lib/crypto.js";
import { formatBytes } from "../../lib/format.js";
import { prisma } from "../../lib/prisma.js";
import { createWorker, enqueue } from "../../lib/queue.js";
import { R2_PRIVATE_BUCKET, getDownloadUrl, uploadStream } from "../../lib/storage.js";
import { createUazapiClient } from "../../lib/uazapi/index.js";
import { env } from "../../env.js";

export const MEDIA_QUEUE = "whatsapp-media";

export type MediaJob = { messageId: string };

/**
 * Teto de download. Com o upload em stream, o custo de um arquivo grande não é mais memória —
 * é storage. Então o número aqui é política de retenção, não limite técnico: 100 MB passa longe
 * de qualquer vídeo que o WhatsApp entregue na prática (um de 30 MB já batia no teto anterior,
 * de 25 MB, que fora dimensionado supondo o limite antigo de 16 MB do WhatsApp).
 */
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

/**
 * A uazapi guarda a mídia por ~2 dias. Guardamos uma validade menor de propósito: entregar ao front
 * um link que morreu é pior do que dizer que a mídia ainda não está pronta.
 */
const TEMP_URL_TTL_MS = 36 * 60 * 60 * 1000;

/** TTL da presigned: curto porque é gerada no momento de exibir, não guardada em cache. */
const PRESIGNED_TTL_SECONDS = 10 * 60;

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "application/pdf": "pdf",
};

const extensionFor = (mime: string | null, filename: string | null) => {
  const fromName = filename?.includes(".") ? filename.split(".").pop() : null;
  if (fromName) return fromName.toLowerCase();
  // "audio/ogg; codecs=opus" precisa perder o parâmetro antes de virar chave
  const base = (mime ?? "").split(";")[0]!.trim();
  return EXTENSION[base] ?? "bin";
};

/**
 * Envolve a origem contando o que passa e cortando no teto.
 *
 * Existe porque, sem buffer, não há mais o que medir depois — e a `flag` é lida em vez do tipo do
 * erro porque o que o SDK propaga do stream não é garantidamente o mesmo objeto lançado aqui.
 * `bytes` também é a fonte do `mediaSize`, que antes vinha do tamanho do buffer.
 */
const measured = (source: Readable, limit: number) => {
  const state = { bytes: 0, exceeded: false };
  const stream = Readable.from(
    (async function* () {
      for await (const chunk of source) {
        state.bytes += chunk.length;
        if (state.bytes > limit) {
          state.exceeded = true;
          throw new Error(`arquivo acima do limite (${state.bytes} bytes)`);
        }
        yield chunk;
      }
    })(),
  );
  return {
    stream,
    get bytes() {
      return state.bytes;
    },
    get exceeded() {
      return state.exceeded;
    },
  };
};

const fail = (messageId: string, reason: string) =>
  prisma.whatsappMessage.update({
    where: { id: messageId },
    data: { mediaStatus: WhatsappMediaStatus.failed, mediaError: reason },
  });

// o texto vai direto para a bolha, então diz o tamanho e o teto — sem isso "acima do limite"
// não informa se faltou pouco ou muito
const tooLarge = (bytes: number | null, limit: number) =>
  `arquivo de ${formatBytes(bytes)} acima do limite de ${formatBytes(limit)}`;

/**
 * Motivo genérico de propósito.
 *
 * Os caminhos conhecidos (teto, erro da uazapi, HTTP do download) já chamam `fail` com texto
 * próprio; o que sobra para cá é exceção inesperada, e `error.message` cru vira mensagem para o
 * corretor ler na bolha. Token corrompido, por exemplo, produziria erro de criptografia na tela.
 */
const UNEXPECTED_REASON = "não foi possível baixar o arquivo";

/**
 * Baixa a mídia e sobe ao R2. Erro aqui é tratado por `processMediaJob`, que envolve esta função.
 *
 * `maxBytes` só existe para o teste: exercitar o corte no meio do stream com o teto real exigiria
 * mover 100 MB de verdade por download, contador e upload, e a suíte roda contra storage local.
 */
const runMediaJob = async (job: MediaJob, maxBytes = MAX_MEDIA_BYTES) => {
  const message = await prisma.whatsappMessage.findUnique({
    where: { id: job.messageId },
    include: { conversation: { include: { instance: true } } },
  });
  if (!message || message.mediaStatus === WhatsappMediaStatus.ready) return;

  if ((message.mediaSize ?? 0) > maxBytes) {
    // recusa antes de baixar, usando o fileLength que já veio no webhook
    await fail(message.id, tooLarge(message.mediaSize, maxBytes));
    return;
  }

  const instance = message.conversation.instance;
  if (!env.UAZAPI_BASE_URL) {
    await fail(message.id, "integração não configurada");
    return;
  }

  const client = createUazapiClient({
    baseURL: env.UAZAPI_BASE_URL,
    token: decryptToken(instance.tokenEnc),
  });

  // a uazapi endereça a mídia pelo id do provedor, sem o prefixo `owner:` do id interno
  const result = await client.messages.download({
    id: message.providerMessageId ?? message.providerId,
    return_link: true,
  });
  if (!result.success || !result.data.fileURL) {
    await fail(message.id, result.success ? "download sem fileURL" : result.error.error);
    return;
  }

  const fileURL = result.data.fileURL;
  const mime = result.data.mimetype ?? message.mediaMime ?? "application/octet-stream";

  // grava a URL temporária ANTES de subir ao R2: a partir daqui a tela já exibe a mídia, sem
  // esperar o upload terminar
  await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: {
      mediaTempUrl: fileURL,
      mediaTempExpiresAt: new Date(Date.now() + TEMP_URL_TTL_MS),
      mediaMime: mime,
    },
  });

  const response = await fetch(fileURL);
  if (!response.ok || !response.body) {
    await fail(message.id, `falha ao baixar: HTTP ${response.status}`);
    return;
  }

  const key = `org/${message.organizationId}/whatsapp/${message.conversationId}/${message.id}.${extensionFor(mime, message.mediaFilename)}`;
  // o `fileLength` do webhook já foi conferido lá em cima, mas ele é declaração do provedor: o
  // tamanho de verdade só se conhece contando o que passa
  const medida = measured(Readable.fromWeb(response.body as StreamWebReadable), maxBytes);

  try {
    await uploadStream(R2_PRIVATE_BUCKET, key, medida.stream, mime);
  } catch (error) {
    // o estouro chega aqui pelo stream, e o SDK já abortou o multipart antes de propagar
    if (medida.exceeded) {
      await fail(message.id, tooLarge(medida.bytes, maxBytes));
      return;
    }
    throw error;
  }

  await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: {
      mediaKey: key,
      mediaSize: medida.bytes,
      mediaStatus: WhatsappMediaStatus.ready,
      // a partir daqui quem manda é o R2; a temporária morreria em horas
      mediaTempUrl: null,
      mediaTempExpiresAt: null,
      mediaError: null,
    },
  });
};

/**
 * Registra a falha na própria mensagem e relança.
 *
 * Relançar é o que mantém as retentativas do BullMQ (`attempts: 3` em `lib/queue.ts`); registrar é o
 * que impede o estado mudo. Sem isto, uma queda de rede no meio do upload deixava a mídia em
 * `pending` **para sempre** — as três tentativas se esgotavam em silêncio e a bolha nunca dizia
 * por quê, porque só `ingest.service` enfileira e ninguém reprocessa.
 *
 * O erro gravado é transitório enquanto há tentativa pela frente: quando uma dá certo, o update
 * final zera `mediaError` e o status volta para `ready`.
 */
export const processMediaJob = async (job: MediaJob, maxBytes = MAX_MEDIA_BYTES) => {
  try {
    await runMediaJob(job, maxBytes);
  } catch (error) {
    await fail(job.messageId, UNEXPECTED_REASON);
    throw error;
  }
};

createWorker<MediaJob>(MEDIA_QUEUE, async (job) => processMediaJob(job.data));

export const enqueueMediaJob = (job: MediaJob) => enqueue(MEDIA_QUEUE, job);

export type ResolvedMedia = { url: string; source: "r2" | "provider" } | null;

/**
 * Onde a mídia está agora. Único ponto que decide — o front recebe URL pronta e não conhece a
 * diferença entre o arquivo definitivo e a ponte temporária.
 */
export const resolveMediaUrl = async (message: {
  mediaStatus: WhatsappMediaStatus;
  mediaKey: string | null;
  mediaFilename: string | null;
  mediaTempUrl: string | null;
  mediaTempExpiresAt: Date | null;
}): Promise<ResolvedMedia> => {
  if (message.mediaStatus === WhatsappMediaStatus.ready && message.mediaKey) {
    const url = await getDownloadUrl(
      R2_PRIVATE_BUCKET,
      message.mediaKey,
      PRESIGNED_TTL_SECONDS,
      message.mediaFilename ?? undefined,
    );
    return { url, source: "r2" };
  }

  if (message.mediaTempUrl && message.mediaTempExpiresAt && message.mediaTempExpiresAt > new Date()) {
    return { url: message.mediaTempUrl, source: "provider" };
  }

  // a UI cai no mediaThumb, que veio no webhook e sempre esteve lá
  return null;
};
