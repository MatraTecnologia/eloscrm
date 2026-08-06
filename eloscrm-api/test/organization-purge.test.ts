import { Readable } from "node:stream";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { purgeOrganizationAssets } from "../src/modules/audit/organization-purge.service.js";
import { R2_PRIVATE_BUCKET, headFile, uploadStream } from "../src/lib/storage.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

const remoteDelete = vi.fn();
vi.mock("../src/lib/uazapi/index.js", () => ({
  createUazapiClient: () => ({ instance: { delete: remoteDelete } }),
}));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const novaOrg = async (sufixo: string) => {
  const { orgId } = await signUpWithOrg(app, `purge-${sufixo}-${stamp}@eloscrm.test`, `purge-${sufixo}-${stamp}`);
  return orgId;
};

const subirObjeto = async (key: string) => {
  await uploadStream(R2_PRIVATE_BUCKET, key, Readable.from([Buffer.from("conteudo")]), "text/plain");
};

const existeNoBucket = async (key: string) => !!(await headFile(R2_PRIVATE_BUCKET, key).catch(() => null));

describe("purga de assets da organização", () => {
  it("apaga do R2 os anexos e as mídias de WhatsApp da imobiliária", async () => {
    const orgId = await novaOrg("assets");
    const anexoKey = `org/${orgId}/CLIENT/anexo-${stamp}.txt`;
    const midiaKey = `org/${orgId}/whatsapp/midia-${stamp}.txt`;
    await Promise.all([subirObjeto(anexoKey), subirObjeto(midiaKey)]);

    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead com anexo" },
    });
    await prisma.attachment.create({
      data: {
        organizationId: orgId,
        entityType: "CLIENT",
        entityId: client.id,
        key: anexoKey,
        filename: "contrato.txt",
        contentType: "text/plain",
        size: 8,
        status: "READY",
        uploadedById: "user-x",
        uploadedByName: "Corretor Teste",
      },
    });

    const instance = await prisma.uazapiInstance.create({
      data: {
        organizationId: orgId,
        remoteId: `remote-purge-${stamp}`,
        name: "purge",
        tokenEnc: encryptToken(`tok-purge-${stamp}`),
        tokenHash: hashToken(`tok-purge-${stamp}`),
        webhookSecret: `secret-purge-${stamp}`,
      },
    });
    const conversation = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId: instance.id, chatid: `purge-${stamp}@s.whatsapp.net` },
    });
    await prisma.whatsappMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        providerId: `owner:PURGE-${stamp}`,
        direction: "inbound",
        type: "image",
        mediaKey: midiaKey,
        mediaStatus: "ready",
        sentAt: new Date(),
      },
    });

    expect(await existeNoBucket(anexoKey)).toBe(true);
    expect(await existeNoBucket(midiaKey)).toBe(true);

    remoteDelete.mockResolvedValue({ success: true, data: {} });
    const resultado = await purgeOrganizationAssets(orgId);

    expect(resultado.objects).toBe(2);
    expect(resultado.failedObjects).toEqual([]);
    expect(resultado.instanceRemoved).toBe(true);
    // a instância também sai do provedor: só apagar a linha deixaria o número conectado na uazapi
    expect(remoteDelete).toHaveBeenCalled();
    expect(await existeNoBucket(anexoKey)).toBe(false);
    expect(await existeNoBucket(midiaKey)).toBe(false);
  });

  it("organização sem arquivo nem instância não chama storage nem provedor", async () => {
    const orgId = await novaOrg("vazia");
    remoteDelete.mockClear();

    const resultado = await purgeOrganizationAssets(orgId);

    expect(resultado).toEqual({ objects: 0, failedObjects: [], instanceRemoved: false });
    expect(remoteDelete).not.toHaveBeenCalled();
  });

  it("excluir a imobiliária leva o domínio inteiro, auditoria incluída", async () => {
    const orgId = await novaOrg("cascade");
    const client = await prisma.client.create({
      data: { organizationId: orgId, name: "Lead que vai junto" },
    });
    // o funil padrão é criado sob demanda (ensureDefaultPipeline), não na criação da organização
    const pipeline = await prisma.pipeline.create({
      data: { organizationId: orgId, name: "Vendas", position: 0 },
    });
    const stage = await prisma.stage.create({
      data: { organizationId: orgId, pipelineId: pipeline.id, name: "Contato", position: 0 },
    });
    await prisma.deal.create({
      data: {
        organizationId: orgId,
        clientId: client.id,
        title: "Negócio que vai junto",
        pipelineId: pipeline.id,
        stageId: stage.id,
      },
    });
    // a criação da organização já deixou eventos (ORGANIZATION/CREATED, MEMBER_ADDED)
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId } })).toBeGreaterThan(0);

    await prisma.organization.delete({ where: { id: orgId } });

    const [eventos, clientes, negocios, membros] = await Promise.all([
      prisma.auditEvent.count({ where: { organizationId: orgId } }),
      prisma.client.count({ where: { organizationId: orgId } }),
      prisma.deal.count({ where: { organizationId: orgId } }),
      prisma.member.count({ where: { organizationId: orgId } }),
    ]);
    // é a decisão do produto: excluir a imobiliária apaga tudo que é dela, o log inclusive
    expect({ eventos, clientes, negocios, membros }).toEqual({
      eventos: 0,
      clientes: 0,
      negocios: 0,
      membros: 0,
    });
  });
});
