import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/crypto.js";
import { getFile, R2_PRIVATE_BUCKET } from "../src/lib/storage.js";

const remote = { messages: { download: vi.fn() } };
vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => remote }));

const { processMediaJob, resolveMediaUrl } = await import("../src/modules/whatsapp/media.service.js");

const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";
let conversationId = "";
const ARQUIVO = Buffer.from("conteudo-binario-de-teste");

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `media-${stamp}`, slug: `media-${stamp}` },
  });
  orgId = org.id;
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-media-${stamp}`,
      name: "media",
      // o service descriptografa o token da instância antes de falar com a uazapi
      tokenEnc: (await import("../src/lib/crypto.js")).encryptToken("tok-media"),
      tokenHash: hashToken(`tok-media-${stamp}`),
      webhookSecret: `secret-media-${stamp}`,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      instanceId: instance.id,
      chatid: `5511999${stamp}@s.whatsapp.net`,
    },
  });
  conversationId = conversation.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  // servidor de mídia da uazapi: o service baixa a fileURL antes de subir ao R2
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(ARQUIVO, { status: 200 })),
  );
});

let seq = 0;
const criarMensagem = (data: Record<string, unknown> = {}) =>
  prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `owner:MEDIA${seq}`,
      providerMessageId: `MEDIA${seq++}`,
      direction: "inbound",
      type: "image",
      status: "sent",
      mediaStatus: "pending",
      mediaMime: "image/jpeg",
      mediaSize: 18196,
      sentAt: new Date(),
      ...data,
    },
  });

describe("download de mídia", () => {
  it("grava a URL temporária antes do upload e depois troca pela chave do R2", async () => {
    const msg = await criarMensagem();
    remote.messages.download.mockResolvedValue({
      success: true,
      data: { fileURL: "https://uazapi.test/arquivo.jpg", mimetype: "image/jpeg" },
    });

    await processMediaJob({ messageId: msg.id });

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.mediaStatus).toBe("ready");
    expect(salvo.mediaKey).toContain(`org/${orgId}/whatsapp/${conversationId}/`);
    expect(salvo.mediaKey).toMatch(/\.jpg$/);
    // a temporária é descartada: ela morre em horas e o R2 é o definitivo
    expect(salvo.mediaTempUrl).toBeNull();
    expect(salvo.mediaSize).toBe(ARQUIVO.byteLength);

    // o arquivo existe mesmo no bucket, com o conteúdo certo
    expect(await getFile(R2_PRIVATE_BUCKET, salvo.mediaKey!)).toEqual(ARQUIVO);
  });

  it("endereça o download pelo id do provedor, sem o prefixo owner:", async () => {
    const msg = await criarMensagem({ providerId: "554391834229:ABC123", providerMessageId: "ABC123" });
    remote.messages.download.mockResolvedValue({
      success: true,
      data: { fileURL: "https://uazapi.test/a.jpg", mimetype: "image/jpeg" },
    });

    await processMediaJob({ messageId: msg.id });

    expect(remote.messages.download).toHaveBeenCalledWith({ id: "ABC123", return_link: true });
  });

  it("recusa arquivo grande SEM chamar o download", async () => {
    const msg = await criarMensagem({ mediaSize: 40 * 1024 * 1024 });

    await processMediaJob({ messageId: msg.id });

    expect(remote.messages.download).not.toHaveBeenCalled();
    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.mediaStatus).toBe("failed");
    expect(salvo.mediaError).toContain("limite");
  });

  it("falha do provedor não apaga a mensagem — só marca a mídia", async () => {
    const msg = await criarMensagem({ text: "veja isto" });
    remote.messages.download.mockResolvedValue({
      success: false,
      error: { status: 500, error: "boom" },
    });

    await processMediaJob({ messageId: msg.id });

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.mediaStatus).toBe("failed");
    expect(salvo.mediaError).toBe("boom");
    expect(salvo.text).toBe("veja isto");
  });

  it("não refaz o trabalho de uma mídia já pronta", async () => {
    const msg = await criarMensagem({ mediaStatus: "ready", mediaKey: "org/x/y.jpg" });
    await processMediaJob({ messageId: msg.id });
    expect(remote.messages.download).not.toHaveBeenCalled();
  });

  it("usa a extensão do nome do arquivo quando ele vem (documento)", async () => {
    const msg = await criarMensagem({
      type: "document",
      mediaMime: "application/pdf",
      mediaFilename: "contrato.pdf",
    });
    remote.messages.download.mockResolvedValue({
      success: true,
      data: { fileURL: "https://uazapi.test/doc", mimetype: "application/pdf" },
    });

    await processMediaJob({ messageId: msg.id });

    const salvo = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(salvo.mediaKey).toMatch(/\.pdf$/);
  });
});

describe("resolvedor de URL", () => {
  it("pronta → presigned do R2", async () => {
    const resolvido = await resolveMediaUrl({
      mediaStatus: "ready",
      mediaKey: "org/a/b/c.jpg",
      mediaFilename: null,
      mediaTempUrl: null,
      mediaTempExpiresAt: null,
    });
    expect(resolvido?.source).toBe("r2");
    expect(resolvido?.url).toContain("X-Amz-Signature");
  });

  it("na fila com temporária válida → URL do provedor", async () => {
    const resolvido = await resolveMediaUrl({
      mediaStatus: "pending",
      mediaKey: null,
      mediaFilename: null,
      mediaTempUrl: "https://uazapi.test/temp.jpg",
      mediaTempExpiresAt: new Date(Date.now() + 60_000),
    });
    expect(resolvido).toEqual({ url: "https://uazapi.test/temp.jpg", source: "provider" });
  });

  it("temporária vencida → nada, para não entregar link morto", async () => {
    const resolvido = await resolveMediaUrl({
      mediaStatus: "pending",
      mediaKey: null,
      mediaFilename: null,
      mediaTempUrl: "https://uazapi.test/temp.jpg",
      mediaTempExpiresAt: new Date(Date.now() - 60_000),
    });
    expect(resolvido).toBeNull();
  });

  it("falhou → nada (a UI cai no thumbnail que veio no webhook)", async () => {
    const resolvido = await resolveMediaUrl({
      mediaStatus: "failed",
      mediaKey: null,
      mediaFilename: null,
      mediaTempUrl: null,
      mediaTempExpiresAt: null,
    });
    expect(resolvido).toBeNull();
  });
});
