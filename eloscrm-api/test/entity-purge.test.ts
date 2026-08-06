import { Readable } from "node:stream";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity } from "../src/generated/prisma/client.js";
import { R2_PRIVATE_BUCKET, headFile, uploadStream } from "../src/lib/storage.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * O que sobra depois de excluir um lead ou um negócio.
 *
 * `Comment` e `Attachment` não têm FK para a entidade (o par entityType/entityId serve três tabelas),
 * então o cascade do Postgres **não** os alcança: quem apaga é o service. Este arquivo é o que prova
 * que nada fica para trás — nem linha invisível no banco, nem objeto pago no bucket.
 */
let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let pipelineId = "";
let stageId = "";

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload });

const del = (url: string) => app.inject({ method: "DELETE", url, headers: { cookie } });

const existeNoBucket = async (key: string) =>
  !!(await headFile(R2_PRIVATE_BUCKET, key).catch(() => null));

/** Anexo pronto, com objeto de verdade no bucket — chave inventada não provaria a purga. */
const anexar = async (entityType: AuditEntity, entityId: string, nome: string) => {
  const key = `org/${orgId}/${entityType}/${entityId}/${nome}-${stamp}.txt`;
  await uploadStream(R2_PRIVATE_BUCKET, key, Readable.from([Buffer.from("conteudo")]), "text/plain");
  const attachment = await prisma.attachment.create({
    data: {
      organizationId: orgId,
      entityType,
      entityId,
      key,
      filename: `${nome}.txt`,
      contentType: "text/plain",
      size: 8,
      status: "READY",
      uploadedById: "user-x",
      uploadedByName: "Corretor Teste",
    },
  });
  return { key, id: attachment.id };
};

const comentar = (entityType: AuditEntity, entityId: string) =>
  post("/v1/comments", { entityType, entityId, body: `comentário de ${entityType}` });

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `purge-ent-${stamp}@eloscrm.test`, `purge-ent-${stamp}`));

  const pipeline = await prisma.pipeline.create({
    data: { organizationId: orgId, name: `Funil ${stamp}`, position: 0 },
  });
  pipelineId = pipeline.id;
  const stage = await prisma.stage.create({
    data: { organizationId: orgId, pipelineId, name: "Contato", position: 0 },
  });
  stageId = stage.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** Lead com um negócio, uma atividade, comentários e anexos nos três níveis. */
const montarLead = async (nome: string) => {
  const client = (await post("/v1/clients", { name: nome })).json();
  const deal = (
    await post("/v1/deals", { clientId: client.id, title: `Negócio de ${nome}`, pipelineId, stageId })
  ).json();
  const activity = (
    await post("/v1/activities", {
      clientId: client.id,
      dealId: deal.id,
      type: "CALL",
      description: `Ligação sobre ${nome}`,
    })
  ).json();

  await comentar(AuditEntity.CLIENT, client.id);
  await comentar(AuditEntity.DEAL, deal.id);
  await comentar(AuditEntity.ACTIVITY, activity.id);

  const anexos = {
    client: await anexar(AuditEntity.CLIENT, client.id, "contrato"),
    deal: await anexar(AuditEntity.DEAL, deal.id, "proposta"),
    activity: await anexar(AuditEntity.ACTIVITY, activity.id, "ata"),
  };

  return { client, deal, activity, anexos };
};

const sobrou = async (ids: { clientId?: string; dealId?: string; activityId?: string }) => {
  const entityIds = [ids.clientId, ids.dealId, ids.activityId].filter(Boolean) as string[];
  const [comments, attachments] = await Promise.all([
    prisma.comment.count({ where: { organizationId: orgId, entityId: { in: entityIds } } }),
    prisma.attachment.count({ where: { organizationId: orgId, entityId: { in: entityIds } } }),
  ]);
  return { comments, attachments };
};

describe("exclusão de lead", () => {
  it("leva negócio, atividade, comentários, anexos e os objetos do bucket", async () => {
    const { client, deal, activity, anexos } = await montarLead("Lead Completo");

    // tudo no lugar antes do delete, senão o teste passaria por não ter o que apagar
    expect(await sobrou({ clientId: client.id, dealId: deal.id, activityId: activity.id })).toEqual({
      comments: 3,
      attachments: 3,
    });
    expect(await existeNoBucket(anexos.client.key)).toBe(true);
    expect(await existeNoBucket(anexos.deal.key)).toBe(true);
    expect(await existeNoBucket(anexos.activity.key)).toBe(true);

    expect((await del(`/v1/clients/${client.id}`)).statusCode).toBe(204);

    // cascade do banco
    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();
    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).toBeNull();
    expect(await prisma.activity.findUnique({ where: { id: activity.id } })).toBeNull();

    // o que o cascade NÃO alcança, e o service precisa apagar
    expect(await sobrou({ clientId: client.id, dealId: deal.id, activityId: activity.id })).toEqual({
      comments: 0,
      attachments: 0,
    });
    expect(await existeNoBucket(anexos.client.key)).toBe(false);
    expect(await existeNoBucket(anexos.deal.key)).toBe(false);
    expect(await existeNoBucket(anexos.activity.key)).toBe(false);

    // a auditoria fica: é o único registro de que o lead existiu
    const evento = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityId: client.id, action: AuditAction.DELETED },
    });
    expect(evento.entityLabel).toBe("Lead Completo");
  });

  it("não toca no que é de outro lead", async () => {
    const alvo = await montarLead("Lead Que Sai");
    const vizinho = await montarLead("Lead Que Fica");

    await del(`/v1/clients/${alvo.client.id}`);

    expect(
      await sobrou({
        clientId: vizinho.client.id,
        dealId: vizinho.deal.id,
        activityId: vizinho.activity.id,
      }),
    ).toEqual({ comments: 3, attachments: 3 });
    expect(await existeNoBucket(vizinho.anexos.deal.key)).toBe(true);
  });

  it("desvincula a conversa em vez de apagá-la — o WhatsApp não é registro do CRM", async () => {
    const { client } = await montarLead("Lead Com Conversa");
    const instance = await prisma.uazapiInstance.create({
      data: {
        organizationId: orgId,
        remoteId: `remote-purge-ent-${stamp}`,
        name: "purge-ent",
        tokenEnc: "x",
        tokenHash: `hash-purge-ent-${stamp}`,
        webhookSecret: `secret-purge-ent-${stamp}`,
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        instanceId: instance.id,
        chatid: `purge-ent-${stamp}@s.whatsapp.net`,
        clientId: client.id,
      },
    });

    await del(`/v1/clients/${client.id}`);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(depois.clientId).toBeNull();
  });
});

describe("exclusão de negócio", () => {
  it("leva a atividade, os comentários, os anexos e os objetos — e preserva o lead", async () => {
    const { client, deal, activity, anexos } = await montarLead("Lead Do Negócio");

    expect((await del(`/v1/deals/${deal.id}`)).statusCode).toBe(204);

    expect(await prisma.deal.findUnique({ where: { id: deal.id } })).toBeNull();
    expect(await prisma.activity.findUnique({ where: { id: activity.id } })).toBeNull();
    expect(await sobrou({ dealId: deal.id, activityId: activity.id })).toEqual({
      comments: 0,
      attachments: 0,
    });
    expect(await existeNoBucket(anexos.deal.key)).toBe(false);
    expect(await existeNoBucket(anexos.activity.key)).toBe(false);

    // o lead e o que é dele continuam de pé
    expect(await prisma.client.findUnique({ where: { id: client.id } })).not.toBeNull();
    expect(await sobrou({ clientId: client.id })).toEqual({ comments: 1, attachments: 1 });
    expect(await existeNoBucket(anexos.client.key)).toBe(true);
  });
});

describe("exclusão de atividade", () => {
  it("leva os comentários e o anexo dela", async () => {
    const { client, deal, activity, anexos } = await montarLead("Lead Da Atividade");

    expect((await del(`/v1/activities/${activity.id}`)).statusCode).toBe(204);

    expect(await sobrou({ activityId: activity.id })).toEqual({ comments: 0, attachments: 0 });
    expect(await existeNoBucket(anexos.activity.key)).toBe(false);
    // lead e negócio seguem intactos
    expect(await sobrou({ clientId: client.id, dealId: deal.id })).toEqual({
      comments: 2,
      attachments: 2,
    });
  });
});
