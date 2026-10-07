import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { R2_PRIVATE_BUCKET, r2, uploadStream, slugifyFilename, deleteFile } from "../../lib/storage.js";
import { httpError } from "../../lib/http-error.js";
import { getOfficialCredentials } from "../channel-connections/channel-connections.service.js";
import * as repo from "./outbound.repo.js";

// Limite do CRM para esta primeira versão: imagens até 5 MiB; áudio, vídeo e PDF até 16 MiB.
export const mediaTypes = {
  "image/jpeg": "image", "image/png": "image", "audio/mpeg": "audio", "audio/ogg": "audio", "video/mp4": "video", "application/pdf": "document",
} as const;
export type MediaMime = keyof typeof mediaTypes;
export const digestOf = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
export const validateMedia = (buffer: Buffer, mime: MediaMime) => {
  const limit = mime.startsWith("image/") ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
  const valid = {
    "image/jpeg": buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    "image/png": buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "audio/mpeg": buffer.subarray(0, 3).toString() === "ID3" || (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0),
    "audio/ogg": buffer.subarray(0, 4).toString() === "OggS" && buffer.includes(Buffer.from("OpusHead")),
    "video/mp4": buffer.subarray(4, 8).toString() === "ftyp",
    "application/pdf": buffer.subarray(0, 5).toString() === "%PDF-",
  }[mime];
  if (buffer.length === 0 || buffer.length > limit || !valid) throw httpError(422, "OFFICIAL_MEDIA_INVALID", "Arquivo vazio, acima do limite ou incompatível com o tipo declarado");
};
export const storeMedia = async (orgId: string, connectionId: string, buffer: Buffer, mime: MediaMime, originalFilename: string) => {
  await getOfficialCredentials(orgId, connectionId);
  validateMedia(buffer, mime);
  const id = randomUUID();
  const filename = slugifyFilename(originalFilename) || "file";
  const key = `org/${orgId}/whatsapp/official/${id}/${filename}`;
  await uploadStream(R2_PRIVATE_BUCKET, key, Readable.from(buffer), mime);
  try { return await repo.saveUpload({ id, organizationId: orgId, connectionId, key, mime, size: buffer.length, digest: digestOf(buffer), filename }); }
  catch (error) { await deleteFile(R2_PRIVATE_BUCKET, key).catch(() => {}); throw error; }
};
export const readMedia = async (upload: { key: string; mime: string; size: number; digest: string }) => {
  const response = await r2().send(new GetObjectCommand({ Bucket: R2_PRIVATE_BUCKET, Key: upload.key }));
  const body = response.Body;
  if (!body) throw httpError(422, "OFFICIAL_MEDIA_CHANGED", "O arquivo não está disponível para envio");
  try {
    if (response.ContentLength !== upload.size || upload.size > 16 * 1024 * 1024) throw httpError(422, "OFFICIAL_MEDIA_CHANGED", "O arquivo não está disponível para envio");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > upload.size) throw httpError(422, "OFFICIAL_MEDIA_CHANGED", "O arquivo excedeu o tamanho validado");
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (size !== upload.size || digestOf(buffer) !== upload.digest || !(upload.mime in mediaTypes)) throw httpError(422, "OFFICIAL_MEDIA_CHANGED", "O arquivo foi alterado após o upload");
    validateMedia(buffer, upload.mime as MediaMime);
    return buffer;
  } finally { if (body instanceof Readable) body.destroy(); }
};
