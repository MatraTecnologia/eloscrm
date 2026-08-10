import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditEntity, AuditSource } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let instanceId = "";
let pipelineId = "";
let stageId = "";

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `namefix-${stamp}@eloscrm.test`, `namefix-${stamp}`));

  await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  const pipeline = await prisma.pipeline.findFirstOrThrow({ where: { organizationId: orgId } });
  pipelineId = pipeline.id;
  stageId = (await prisma.stage.findFirstOrThrow({ where: { pipelineId } })).id;

  instanceId = (
    await prisma.uazapiInstance.create({
      data: {
        organizationId: orgId,
        remoteId: `remote-namefix-${stamp}`,
        name: "namefix",
        tokenEnc: "x.y.z",
        tokenHash: "hash",
        webhookSecret: `segredo-${stamp}`,
      },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.deal.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
});

let chatSeq = 0;

const lead = (name: string, phone: string | null) =>
  prisma.client.create({ data: { organizationId: orgId, name, phone } });

const conversa = (
  clientId: string,
  data: { contactName?: string; waName?: string; isGroup?: boolean },
) =>
  prisma.conversation.create({
    data: {
      organizationId: orgId,
      instanceId,
      chatid: `chat-${chatSeq++}-${stamp}@s.whatsapp.net`,
      clientId,
      lastMessageAt: new Date(),
      ...data,
    },
  });

const card = (clientId: string, title: string) =>
  prisma.deal.create({ data: { organizationId: orgId, clientId, pipelineId, stageId, title } });

const listar = async () => {
  const res = await app.inject({ method: "GET", url: "/v1/clients/name-fixes", headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    clientId: string;
    currentName: string;
    suggestion: string | null;
    source: string | null;
    deals: number;
  }[];
};

const aplicar = (items: { clientId: string; name: string }[]) =>
  app.inject({
    method: "POST",
    url: "/v1/clients/name-fixes",
    headers: { cookie },
    payload: { items },
  });

describe("lista de nomes a corrigir", () => {
  it("traz só o lead chamado pelo próprio telefone", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    await lead("Mariana Costa", "(43) 9841-4905");
    // nome parecido com telefone, mas não é o telefone dele: quem digitou isso foi gente
    await lead("(43) 9841-4906", "(43) 9841-4907");

    const items = await listar();

    expect(items).toHaveLength(1);
    expect(items[0]!.clientId).toBe(auto.id);
  });

  it("o contato salvo na agenda vence o nome do perfil", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    await conversa(auto.id, { contactName: "Camila Souza", waName: "Cami ✨" });

    const [item] = await listar();

    expect(item!.suggestion).toBe("Camila Souza");
    expect(item!.source).toBe("CONTACT");
  });

  it("sem contato salvo, sugere o nome do perfil", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    await conversa(auto.id, { waName: "Cami ✨" });

    const [item] = await listar();

    expect(item!.suggestion).toBe("Cami ✨");
    expect(item!.source).toBe("PROFILE");
  });

  it("o nome de um grupo nunca vira sugestão", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    await conversa(auto.id, { waName: "Sonho do apartamento", isGroup: true });

    const [item] = await listar();

    expect(item!.suggestion).toBeNull();
    expect(item!.source).toBeNull();
  });

  it("lead sem nome em lugar nenhum continua na lista, para alguém digitar", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    await conversa(auto.id, {});

    const [item] = await listar();

    expect(item!.clientId).toBe(auto.id);
    expect(item!.suggestion).toBeNull();
  });

  it("conta os cards que ainda repetem o nome automático", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    await card(auto.id, "Atendimento — (43) 9841-4904");
    await card(auto.id, "Reserva do 302");

    const [item] = await listar();

    expect(item!.deals).toBe(1);
  });

  it("quem tem sugestão aparece primeiro", async () => {
    const semNome = await lead("(43) 9841-4904", "(43) 9841-4904");
    await conversa(semNome.id, {});
    const comNome = await lead("(43) 9841-4905", "(43) 9841-4905");
    await conversa(comNome.id, { waName: "Rafael" });

    const items = await listar();

    expect(items.map((item) => item.clientId)).toEqual([comNome.id, semNome.id]);
  });
});

describe("aplicar as correções", () => {
  it("renomeia o lead e o card de título automático", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");
    const deal = await card(auto.id, "Atendimento — (43) 9841-4904");
    const outro = await card(auto.id, "Reserva do 302");

    const res = await aplicar([{ clientId: auto.id, name: "Camila Souza" }]);

    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(1);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: auto.id } })).name).toBe(
      "Camila Souza",
    );
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).title).toBe(
      "Atendimento — Camila Souza",
    );
    // título digitado por gente não é derivado de nome nenhum
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: outro.id } })).title).toBe(
      "Reserva do 302",
    );
  });

  it("aplica a lista inteira de uma vez", async () => {
    const a = await lead("(43) 9841-4904", "(43) 9841-4904");
    const b = await lead("(43) 9841-4905", "(43) 9841-4905");

    const res = await aplicar([
      { clientId: a.id, name: "Camila" },
      { clientId: b.id, name: "Rafael" },
    ]);

    expect(res.json().applied).toBe(2);
    expect(await listar()).toHaveLength(0);
  });

  it("o autor é quem clicou, não a automação", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");

    await aplicar([{ clientId: auto.id, name: "Camila Souza" }]);

    const evento = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: AuditEntity.CLIENT, entityId: auto.id },
      orderBy: { createdAt: "desc" },
    });
    expect(evento.action).toBe(AuditAction.UPDATED);
    expect(evento.source).toBe(AuditSource.USER);
    expect(evento.actorName).toBe("Corretor Teste");
  });

  it("nome que já é o atual não vira evento nem erro", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");

    const res = await aplicar([{ clientId: auto.id, name: "(43) 9841-4904" }]);

    expect(res.json().applied).toBe(0);
    expect(res.json().results[0].status).toBe("skipped");
    expect(
      await prisma.auditEvent.count({ where: { organizationId: orgId, entityId: auto.id } }),
    ).toBe(0);
  });

  it("nome em branco é recusado pelo schema", async () => {
    const auto = await lead("(43) 9841-4904", "(43) 9841-4904");

    const res = await aplicar([{ clientId: auto.id, name: "   " }]);

    // 422, como todo corpo recusado pelo Zod neste projeto
    expect(res.statusCode).toBe(422);
  });

  it("lead de outra imobiliária derruba o lote inteiro, sem escrever nada", async () => {
    const outra = await signUpWithOrg(app, `namefix-b-${stamp}@eloscrm.test`, `namefix-b-${stamp}`);
    const alheio = await prisma.client.create({
      data: { organizationId: outra.orgId, name: "(43) 9111-2222", phone: "(43) 9111-2222" },
    });
    const meu = await lead("(43) 9841-4904", "(43) 9841-4904");

    const res = await aplicar([
      { clientId: meu.id, name: "Camila" },
      { clientId: alheio.id, name: "Invasor" },
    ]);

    expect(res.statusCode).toBe(404);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: meu.id } })).name).toBe(
      "(43) 9841-4904",
    );
    expect((await prisma.client.findUniqueOrThrow({ where: { id: alheio.id } })).name).toBe(
      "(43) 9111-2222",
    );
  });

  it("a lista de outra imobiliária não vaza", async () => {
    await lead("(43) 9841-4904", "(43) 9841-4904");
    const outra = await signUpWithOrg(app, `namefix-c-${stamp}@eloscrm.test`, `namefix-c-${stamp}`);

    const res = await app.inject({
      method: "GET",
      url: "/v1/clients/name-fixes",
      headers: { cookie: outra.cookie },
    });

    expect(res.json()).toEqual([]);
  });

  it("sem sessão, nada", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/clients/name-fixes" });
    expect(res.statusCode).toBe(401);
  });
});
