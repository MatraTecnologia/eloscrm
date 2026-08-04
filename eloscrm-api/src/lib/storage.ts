import type { Readable } from "node:stream";

import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "../env.js";

const createR2Client = () =>
  new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    forcePathStyle: true,
    // sem isso o SDK embute um checksum CRC32 obrigatório na URL assinada; um PUT
    // feito pelo browser (fetch puro, sem SDK) não sabe calculá-lo e o upload cai com BadDigest.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

let _client: S3Client | null = null;

export const r2 = () => {
  if (!_client) _client = createR2Client();
  return _client;
};

export const R2_PRIVATE_BUCKET = env.R2_PRIVATE_BUCKET_NAME;

export const getDownloadUrl = (
  bucket: string,
  key: string,
  expiresIn = 3600,
  filename?: string,
) =>
  getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // sem isto o navegador abre o arquivo inline: `download` no anchor é ignorado em URL cross-origin
      ...(filename && { ResponseContentDisposition: `attachment; filename="${filename}"` }),
    }),
    { expiresIn },
  );

export const getUploadUrl = (
  bucket: string,
  key: string,
  options: { contentLength: number; contentType: string; expiresIn?: number },
) =>
  getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentLength: options.contentLength,
      ContentType: options.contentType,
    }),
    { expiresIn: options.expiresIn ?? 3600 },
  );

export const getFile = async (bucket: string, key: string) => {
  const response = await r2().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const stream = response.Body;
  if (!stream) throw new Error(`Empty response for ${key}`);
  return Buffer.from(await stream.transformToByteArray());
};

export const headFile = async (bucket: string, key: string) => {
  const response = await r2().send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  return { contentLength: response.ContentLength ?? 0, contentType: response.ContentType ?? null };
};

/**
 * Sobe direto da origem, sem o arquivo inteiro passar pela memória.
 *
 * `queueSize: 1` é o ponto: com o default (4 partes em voo) o consumo volta a crescer com o
 * tamanho do arquivo, que é justamente o que este caminho existe para evitar. Com uma parte por
 * vez o pico fica em ~5 MB, seja o arquivo de 1 MB ou de 100 MB.
 *
 * Corpo que cabe numa parte só vira um PutObject simples — o multipart nem chega a ser aberto.
 * E como `leavePartsOnError` fica no default `false`, stream que morre no meio dispara o
 * `AbortMultipartUpload`: sem isso as partes já enviadas ficariam no bucket, cobrando storage sem
 * aparecer em listagem nenhuma.
 */
export const uploadStream = (
  bucket: string,
  key: string,
  body: Readable,
  contentType: string,
) =>
  new Upload({
    client: r2(),
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
    queueSize: 1,
    partSize: 5 * 1024 * 1024,
  }).done();

export const deleteFile = (bucket: string, key: string) =>
  r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

/** Bulk delete up to 1000 keys per call (R2/S3 limit). Returns keys that failed. */
export const deleteFiles = async (bucket: string, keys: string[]) => {
  if (keys.length === 0) return [];

  const BATCH_SIZE = 1000;
  const failed: string[] = [];

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);

    const result = await r2().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map(Key => ({ Key })),
          Quiet: true,
        },
      }),
    );

    if (result.Errors && result.Errors.length > 0) {
      for (const err of result.Errors) {
        if (err.Key) failed.push(err.Key);
      }
    }
  }

  return failed;
};
