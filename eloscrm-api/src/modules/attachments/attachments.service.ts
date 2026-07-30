import type { Actor } from "../../lib/actor.js";
import { httpError, notFound } from "../../lib/http-error.js";
import { R2_PRIVATE_BUCKET, deleteFile, getDownloadUrl, getUploadUrl, headFile } from "../../lib/storage.js";
import * as repo from "./attachments.repo.js";
import { MAX_SIZE_BYTES } from "./attachments.schema.js";
import type { ListAttachmentsQuery, UploadUrlInput } from "./attachments.schema.js";

const UPLOAD_EXPIRES_IN = 300;
const DOWNLOAD_EXPIRES_IN = 60;

// nome do arquivo não vai cru para a chave: acento, espaço e barra viram problema de URL e de path
const slugify = (filename: string) =>
  filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 100);

export const list = (orgId: string, filters: ListAttachmentsQuery) => repo.listReady(orgId, filters);

const getOwn = async (orgId: string, id: string) => {
  const attachment = await repo.findAttachment(orgId, id);
  if (!attachment) throw notFound("Anexo não encontrado");
  return attachment;
};

export const createUploadUrl = async (orgId: string, data: UploadUrlInput, actor: Actor) => {
  const exists = await repo.entityExistsInOrg(orgId, data.entityType, data.entityId);
  if (!exists) throw notFound("Registro não encontrado");

  // randomUUID em vez de cuid: o projeto não tem gerador de id no runtime, e o global do Node basta
  const key = `org/${orgId}/${data.entityType}/${data.entityId}/${crypto.randomUUID()}-${slugify(data.filename)}`;
  const attachment = await repo.createPending({
    organizationId: orgId,
    entityType: data.entityType,
    entityId: data.entityId,
    key,
    filename: data.filename,
    contentType: data.contentType,
    size: data.size,
    uploadedById: actor.id,
    uploadedByName: actor.name,
  });

  const uploadUrl = await getUploadUrl(R2_PRIVATE_BUCKET, key, {
    contentLength: data.size,
    contentType: data.contentType,
    expiresIn: UPLOAD_EXPIRES_IN,
  });

  return { attachmentId: attachment.id, uploadUrl, key, expiresIn: UPLOAD_EXPIRES_IN };
};

export const confirm = async (orgId: string, id: string) => {
  const attachment = await getOwn(orgId, id);
  // HEAD de verdade: sem isto, um PUT que falhou deixaria linha READY apontando para objeto inexistente
  const head = await headFile(R2_PRIVATE_BUCKET, attachment.key).catch(() => null);
  if (!head) throw httpError(422, "UPLOAD_NOT_FOUND", "O arquivo não chegou ao storage");

  if (head.contentLength > MAX_SIZE_BYTES) {
    throw httpError(422, "UPLOAD_TOO_LARGE", "O arquivo enviado passa do tamanho permitido");
  }

  // o content-type não entra na assinatura do presign (o SDK o marca como unsignable), então é aqui
  // que a allowlist vale de verdade: o cliente pode ter subido qualquer coisa na URL assinada
  if (head.contentType && head.contentType !== attachment.contentType) {
    throw httpError(422, "UPLOAD_TYPE_MISMATCH", "O arquivo enviado não é do tipo informado");
  }

  return repo.markReady(id, head.contentLength);
};

// aspas no filename quebrariam o header Content-Disposition; sem nada sobrando, um nome genérico
const sanitizeFilename = (filename: string) => filename.replace(/"/g, "") || "arquivo";

export const downloadUrl = async (orgId: string, id: string) => {
  const attachment = await getOwn(orgId, id);
  const url = await getDownloadUrl(
    R2_PRIVATE_BUCKET,
    attachment.key,
    DOWNLOAD_EXPIRES_IN,
    sanitizeFilename(attachment.filename),
  );
  return { url, expiresIn: DOWNLOAD_EXPIRES_IN };
};

export const remove = async (orgId: string, id: string) => {
  const attachment = await getOwn(orgId, id);
  // objeto primeiro: linha órfã é recuperável, objeto órfão em bucket privado é invisível para sempre
  await deleteFile(R2_PRIVATE_BUCKET, attachment.key);
  await repo.deleteAttachmentById(id);
};
