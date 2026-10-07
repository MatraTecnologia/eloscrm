import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import * as z from "zod";
import { createWorker, enqueue } from "../../lib/queue.js";
import { deleteFile, getDownloadUrl, R2_PRIVATE_BUCKET, uploadStream } from "../../lib/storage.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { readMediaMetadata } from "../../lib/whatsapp-official/graph.js";
import { downloadOfficialMedia } from "../../lib/whatsapp-official/media-download.js";
import { getOfficialCredentials } from "../channel-connections/channel-connections.service.js";
import { digestOf, validateMedia } from "../whatsapp-outbound/media.service.js";
import * as repo from "./media.repo.js";

export const OFFICIAL_MEDIA_QUEUE = "whatsapp-official-media";
export type OfficialMediaJob = { organizationId: string; messageId: string };
const incomingMimes = ["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/ogg", "video/mp4", "application/pdf"] as const;
const metadataSchema = z.looseObject({ id: z.string(), url: z.string().max(8192), mime_type: z.string().transform(value => value.split(";")[0]!.trim().toLowerCase()).pipe(z.enum(incomingMimes)), file_size: z.union([z.number(), z.string().regex(/^\d{1,9}$/).transform(Number)]).pipe(z.number().int().positive().max(16 * 1024 * 1024)), sha256: z.string().regex(/^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$/) });
export const processOfficialMediaJob = async (job: OfficialMediaJob) => {
  const lease = await repo.claimMedia(job.organizationId, job.messageId);
  if (!lease) return;
  let key: string | undefined;
  try {
    const message = await repo.findMedia(job.organizationId, job.messageId);
    if (!message?.connectionId || !message.officialMediaId) return;
    const credentials = await getOfficialCredentials(job.organizationId, message.connectionId);
    const metadata = metadataSchema.parse(await readMediaMetadata(credentials.accessToken, message.officialMediaId, credentials.phoneNumberId!));
    if (metadata.id !== message.officialMediaId) throw new Error();
    const buffer = await downloadOfficialMedia(metadata.url, credentials.accessToken, metadata.file_size);
    if (metadata.mime_type === "image/webp") {
      if (buffer.length > 5 * 1024 * 1024 || buffer.subarray(0, 4).toString() !== "RIFF" || buffer.subarray(8, 12).toString() !== "WEBP") throw new Error();
    } else validateMedia(buffer, metadata.mime_type);
    if (buffer.length !== metadata.file_size || digestOf(buffer) !== (/^[a-fA-F0-9]{64}$/.test(metadata.sha256) ? metadata.sha256.toLowerCase() : Buffer.from(metadata.sha256, "base64").toString("hex"))) throw new Error();
    key = `org/${job.organizationId}/whatsapp/${message.conversationId}/official/${message.id}/${lease}-${randomUUID()}`;
    await uploadStream(R2_PRIVATE_BUCKET, key, Readable.from(buffer), metadata.mime_type);
    const saved = await repo.finishMedia(job.organizationId, job.messageId, lease, { key, mime: metadata.mime_type, size: buffer.length });
    if (!saved.count) await deleteFile(R2_PRIVATE_BUCKET, key);
  } catch {
    if (key) {
      // Uma resposta perdida do banco pode esconder um commit bem-sucedido; preserve o objeto referenciado.
      try {
        const current = await repo.findMedia(job.organizationId, job.messageId);
        if (current?.mediaKey !== key) await deleteFile(R2_PRIVATE_BUCKET, key).catch(() => {});
      } catch { /* Sem confirmação do banco, remover o objeto poderia apagar uma mídia pronta. */ }
    }
    await repo.failMedia(job.organizationId, job.messageId, lease);
  }
};
createWorker<OfficialMediaJob>(OFFICIAL_MEDIA_QUEUE, async job => processOfficialMediaJob(job.data), 2);
export const enqueueOfficialMediaJob = (job: OfficialMediaJob) => enqueue(OFFICIAL_MEDIA_QUEUE, job, { attempts: 1 });
export const recoverOfficialMedia = async () => {
  await repo.expireExhaustedMedia();
  for (const message of await repo.pendingMedia()) await enqueueOfficialMediaJob({ organizationId: message.organizationId, messageId: message.id });
};
export const retryOfficialMedia = async (orgId: string, id: string) => {
  const message = await repo.findMedia(orgId, id);
  if (!message || !message.officialMediaId) throw notFound("Mídia recebida não encontrada nesta imobiliária");
  if (message.mediaStatus === "ready") return { status: "ready" };
  await getOfficialCredentials(orgId, message.connectionId!);
  if (!(await repo.resetMedia(orgId, id)).count) throw httpError(429, "OFFICIAL_MEDIA_RETRY_WAIT", "Aguarde um minuto antes de tentar novamente");
  await enqueueOfficialMediaJob({ organizationId: orgId, messageId: id });
  return { status: "pending" };
};
export const officialMediaUrl = async (orgId: string, id: string, download = false) => {
  const message = await repo.findMedia(orgId, id);
  if (!message) throw notFound("Mídia não encontrada nesta imobiliária");
  if (message.mediaStatus !== "ready" || !message.mediaKey) return { url: null };
  if (!message.mediaKey.startsWith(`org/${orgId}/whatsapp/${message.conversationId}/`)) throw notFound("Mídia indisponível");
  return { url: await getDownloadUrl(R2_PRIVATE_BUCKET, message.mediaKey, 600, download ? "file" : undefined) };
};

export const scheduleOfficialMediaRecovery = () => {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await recoverOfficialMedia(); } catch { /* As referências continuam persistidas para a próxima rodada. */ }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
};
