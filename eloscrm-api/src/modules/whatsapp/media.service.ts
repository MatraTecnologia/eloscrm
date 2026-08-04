import { WhatsappMediaStatus } from "../../generated/prisma/client.js";
import { decryptToken } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { createWorker, enqueue } from "../../lib/queue.js";
import { R2_PRIVATE_BUCKET, getDownloadUrl, uploadFile } from "../../lib/storage.js";
import { createUazapiClient } from "../../lib/uazapi/index.js";
import { env } from "../../env.js";

export const MEDIA_QUEUE = "whatsapp-media";

export type MediaJob = { messageId: string };

/**
 * Teto de download. A figurinha observada tinha 233 KB — mais de 10× a foto JPEG — então um teto
 * apertado recusaria conteúdo trivial de conversa. 25 MB cobre vídeo do WhatsApp com folga.
 */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

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

const fail = (messageId: string, reason: string) =>
  prisma.whatsappMessage.update({
    where: { id: messageId },
    data: { mediaStatus: WhatsappMediaStatus.failed, mediaError: reason },
  });

export const processMediaJob = async (job: MediaJob) => {
  const message = await prisma.whatsappMessage.findUnique({
    where: { id: job.messageId },
    include: { conversation: { include: { instance: true } } },
  });
  if (!message || message.mediaStatus === WhatsappMediaStatus.ready) return;

  if ((message.mediaSize ?? 0) > MAX_MEDIA_BYTES) {
    // recusa antes de baixar, usando o fileLength que já veio no webhook
    await fail(message.id, `arquivo acima do limite (${message.mediaSize} bytes)`);
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
  if (!response.ok) {
    await fail(message.id, `falha ao baixar: HTTP ${response.status}`);
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    await fail(message.id, `arquivo acima do limite (${buffer.byteLength} bytes)`);
    return;
  }

  const key = `org/${message.organizationId}/whatsapp/${message.conversationId}/${message.id}.${extensionFor(mime, message.mediaFilename)}`;
  await uploadFile(R2_PRIVATE_BUCKET, key, buffer, mime);

  await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: {
      mediaKey: key,
      mediaSize: buffer.byteLength,
      mediaStatus: WhatsappMediaStatus.ready,
      // a partir daqui quem manda é o R2; a temporária morreria em horas
      mediaTempUrl: null,
      mediaTempExpiresAt: null,
      mediaError: null,
    },
  });
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
