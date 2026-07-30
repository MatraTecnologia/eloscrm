import { describe, it, expect } from "vitest";
import { R2_PRIVATE_BUCKET, deleteFile, getDownloadUrl, getUploadUrl, headFile } from "../src/lib/storage.js";

const key = `test/storage-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`;

describe("storage", () => {
  it("assina PUT, sobe pelo browser, confirma por HEAD e apaga", async () => {
    const body = "conteudo de teste";
    const uploadUrl = await getUploadUrl(R2_PRIVATE_BUCKET, key, {
      contentLength: Buffer.byteLength(body),
      contentType: "text/plain",
    });

    // PUT feito como o browser faria: sem SDK, só a URL assinada
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain", "content-length": String(Buffer.byteLength(body)) },
      body,
    });
    expect(put.ok).toBe(true);

    const head = await headFile(R2_PRIVATE_BUCKET, key);
    expect(head.contentLength).toBe(Buffer.byteLength(body));

    const downloadUrl = await getDownloadUrl(R2_PRIVATE_BUCKET, key, 60);
    const get = await fetch(downloadUrl);
    expect(await get.text()).toBe(body);

    await deleteFile(R2_PRIVATE_BUCKET, key);
    await expect(headFile(R2_PRIVATE_BUCKET, key)).rejects.toThrow();
  });

  it("recusa leitura sem assinatura", async () => {
    // objeto precisa existir: senão um 404 por "não achei" passaria disfarçado de "recusei por
    // não estar assinado", e o teste provaria menos do que o nome promete
    const liveKey = `${key}.live`;
    const body = "conteudo de teste";
    const uploadUrl = await getUploadUrl(R2_PRIVATE_BUCKET, liveKey, {
      contentLength: Buffer.byteLength(body),
      contentType: "text/plain",
    });
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain", "content-length": String(Buffer.byteLength(body)) },
      body,
    });
    expect(put.ok).toBe(true);

    // o bucket é privado: a URL sem query de assinatura não pode devolver o objeto
    const bare = `${process.env.R2_ENDPOINT}/${R2_PRIVATE_BUCKET}/${liveKey}`;
    const res = await fetch(bare);
    expect(res.status).toBe(403);

    await deleteFile(R2_PRIVATE_BUCKET, liveKey);
  });
});
