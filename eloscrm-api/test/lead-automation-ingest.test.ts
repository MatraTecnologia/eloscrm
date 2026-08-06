import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/lib/crypto.js";
import { applyToConversation } from "../src/modules/lead-automation/apply.service.js";

vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => ({}) }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = "";
let userId = "";
let instanceId = "";
let pipelineId = "";
let stageId = "";
const SECRET = `segredo-auto-${stamp}`;
const TOKEN = `tok-auto-${stamp}`;
const CHATID = "554398414904@s.whatsapp.net";

beforeAll(async () => {
  app = await makeApp();
  const dono = await signUpWithOrg(app, `autoing-${stamp}@eloscrm.test`, `autoing-${stamp}`);
  orgId = dono.orgId;
  userId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId } })).userId;

  // o funil padrão nasce sob demanda, na primeira listagem
  await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie: dono.cookie } });
  const pipeline = await prisma.pipeline.findFirstOrThrow({ where: { organizationId: orgId } });
  pipelineId = pipeline.id;
  stageId = (
    await prisma.stage.findFirstOrThrow({
      where: { pipelineId, isWon: false, isLost: false },
      orderBy: { position: "asc" },
    })
  ).id;

  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-autoing-${stamp}`,
      name: "autoing",
      tokenEnc: "x.y.z",
      tokenHash: hashToken(TOKEN),
      webhookSecret: SECRET,
      status: "connected",
    },
  });
  instanceId = instance.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.whatsappMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
  await prisma.deal.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
  await prisma.leadAutomation.deleteMany({ where: { organizationId: orgId } });
});

/** Configuração da automação, com tudo ligado por padrão neste arquivo. */
const configurar = (data: Record<string, unknown> = {}) =>
  prisma.leadAutomation.create({
    data: {
      organizationId: orgId,
      autoCreateClient: true,
      autoCreateDeal: true,
      pipelineId,
      stageId,
      autoAssign: true,
      members: { create: [{ userId, active: true }] },
      ...data,
    },
  });

let seq = 0;
const evento = (chat: Record<string, unknown> = {}) => {
  const id = `AUTO${seq++}`;
  return {
    EventType: "messages",
    token: TOKEN,
    owner: "554391834229",
    instanceName: "autoing",
    chat: {
      wa_chatid: CHATID,
      phone: "554398414904",
      wa_name: "Fulano",
      wa_contactName: "Fulano da Silva",
      wa_isGroup: false,
      ...chat,
    },
    message: {
      id: `554391834229:${id}`,
      messageid: id,
      chatid: CHATID,
      sender_pn: "554398414904@s.whatsapp.net",
      senderName: "Fulano",
      fromMe: false,
      type: "text",
      text: "olá",
      content: "olá",
      messageTimestamp: 1785817572632,
    },
  };
};

const post = (body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/webhooks/uazapi/${instanceId}/${SECRET}`, payload: body });

const leadDaConversa = async () => {
  const conversa = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: orgId },
    include: { client: true },
  });
  return conversa.client;
};

describe("automação na entrada de mensagem", () => {
  it("número desconhecido com tudo ligado vira lead, negócio e dono", async () => {
    await configurar();

    const res = await post(evento());
    expect(res.statusCode).toBe(200);

    const lead = await leadDaConversa();
    expect(lead?.name).toBe("Fulano da Silva");
    expect(lead?.source).toBe("WHATSAPP");
    // o CRM guarda telefone com máscara, como no cadastro manual
    expect(lead?.phone).toBe("(43) 9841-4904");
    expect(lead?.ownerId).toBe(userId);

    const negocio = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(negocio.title).toBe("Atendimento — Fulano da Silva");
    expect(negocio.stageId).toBe(stageId);
    expect(negocio.ownerId).toBe(userId);
  });

  it("sem configuração nenhuma, nada acontece — o padrão é não automatizar", async () => {
    await post(evento());

    expect(await leadDaConversa()).toBeNull();
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("chaves desligadas não criam nada", async () => {
    await configurar({ autoCreateClient: false, autoCreateDeal: false, autoAssign: false });

    await post(evento());

    expect(await leadDaConversa()).toBeNull();
  });

  it("o histórico diz que foi a automação", async () => {
    await configurar();
    await post(evento());

    const lead = await leadDaConversa();
    const evt = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: "CLIENT", entityId: lead!.id },
    });
    expect(evt.actorName).toBe("Automação");
    // id vazio viraria string vazia na coluna e se passaria por usuário
    expect(evt.actorId).toBeNull();
    // é o que a tela usa para separar "ninguém clicou" de uma ação de pessoa
    expect(evt.source).toBe("AUTOMATION");

    // o negócio que a mesma automação abre também sai marcado — a origem vem do ator, não é forçada
    const negocio = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });
    const evtDeal = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgId, entityType: "DEAL", entityId: negocio.id },
    });
    expect(evtDeal.source).toBe("AUTOMATION");
  });

  it("lead que já existe ganha negócio e mantém o dono", async () => {
    const outro = await prisma.user.create({
      data: { id: `u-outro-${stamp}`, name: "Outro Corretor", email: `outro-${stamp}@x.test` },
    });
    await prisma.member.create({ data: { organizationId: orgId, userId: outro.id, role: "member" } });
    await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Cliente Antigo",
        phone: "(43) 99841-4904",
        phoneKey: "4398414904",
        ownerId: outro.id,
      },
    });
    await configurar();

    await post(evento());

    const lead = await leadDaConversa();
    expect(lead?.name).toBe("Cliente Antigo");
    // uma mensagem nova não transfere cliente de corretor
    expect(lead?.ownerId).toBe(outro.id);

    const negocio = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });
    // o card vai para quem já atende, não para a roleta
    expect(negocio.ownerId).toBe(outro.id);
  });

  it("não cria segundo negócio quando já há um aberto no funil", async () => {
    await configurar();
    await post(evento());
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(1);

    // segunda mensagem do mesmo lead: sem a regra, cada "bom dia" viraria um card
    await post(evento());
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("negócio movido para outro funil não vira card novo quando o cliente responde", async () => {
    await configurar();
    await post(evento());
    const negocio = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });

    // o corretor tira o negócio do funil da automação — é o fluxo normal de quem separa
    // "novos leads" de "em negociação"
    const outro = await prisma.pipeline.create({
      data: {
        organizationId: orgId,
        name: `Negociação ${stamp}`,
        stages: { create: [{ organizationId: orgId, name: "Em conversa", position: 0 }] },
      },
      include: { stages: true },
    });
    await prisma.deal.update({
      where: { id: negocio.id },
      data: { pipelineId: outro.id, stageId: outro.stages[0].id },
    });

    // o cliente responde: o atendimento continua onde está, não recomeça em "Novo lead"
    await post(evento());

    const negocios = await prisma.deal.findMany({ where: { organizationId: orgId } });
    expect(negocios).toHaveLength(1);
    expect(negocios[0]).toMatchObject({ id: negocio.id, pipelineId: outro.id });
  });

  it("negócio em estágio de ganho não vira card novo quando o cliente responde", async () => {
    await configurar();
    await post(evento());
    const negocio = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });

    // O caso que quebrou em produção: a imobiliária chamou de "APROVADO" um estágio do meio do
    // processo dela e o marcou como ganho. O cliente segue em pleno atendimento — mas uma guarda
    // que só enxerga negócio aberto o perde de vista.
    const segunda = await prisma.pipeline.create({
      data: {
        organizationId: orgId,
        name: `2a etapa ${stamp}`,
        stages: {
          create: [{ organizationId: orgId, name: "Aprovado", position: 0, isWon: true }],
        },
      },
      include: { stages: true },
    });
    await prisma.deal.update({
      where: { id: negocio.id },
      data: { pipelineId: segunda.id, stageId: segunda.stages[0]!.id },
    });

    await post(evento());

    const negocios = await prisma.deal.findMany({ where: { organizationId: orgId } });
    expect(negocios).toHaveLength(1);
    expect(negocios[0]).toMatchObject({ id: negocio.id, pipelineId: segunda.id });
  });

  it("lead em nutrição ganha card novo ao voltar a falar", async () => {
    await configurar();
    await post(evento());
    const negocio = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });
    const lead = await leadDaConversa();

    // nutrir exige fechar os negócios abertos antes; é o registro humano de "este lead esfriou",
    // e é o que distingue "voltou depois de meses" de "está em atendimento agora"
    const perdido = await prisma.stage.findFirstOrThrow({ where: { pipelineId, isLost: true } });
    await prisma.deal.update({ where: { id: negocio.id }, data: { stageId: perdido.id } });
    await prisma.client.update({
      where: { id: lead!.id },
      data: { status: "NURTURING", nurturedAt: new Date() },
    });

    await post(evento());

    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("telefone ambíguo não cria lead — a escolha continua sendo humana", async () => {
    // fixo e celular do mesmo número colidem na phoneKey
    await prisma.client.createMany({
      data: [
        { organizationId: orgId, name: "Fixo", phone: "(43) 3841-4904", phoneKey: "4338414904" },
        { organizationId: orgId, name: "Celular", phone: "(43) 98414-904", phoneKey: "4338414904" },
      ],
    });
    await configurar();

    await post(
      evento({ phone: "554338414904", wa_chatid: "554338414904@s.whatsapp.net" }),
    );

    const conversa = await prisma.conversation.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(conversa.clientId).toBeNull();
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("funil configurado que foi apagado não impede a mensagem de entrar", async () => {
    await configurar({ stageId: `nao-existe-${stamp}` });

    const res = await post(evento());
    expect(res.statusCode).toBe(200);

    // o lead é criado, o negócio não — e o webhook responde normalmente
    expect(await leadDaConversa()).not.toBeNull();
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.whatsappMessage.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("estágio inexistente é tratado, não estourado e engolido", async () => {
    await configurar({ stageId: `nao-existe-${stamp}` });
    const conversa = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId, chatid: `direto-${stamp}@s.whatsapp.net` },
    });

    // chamada direta, sem o catch do ingest: pelo webhook, uma exceção aqui seria engolida e o
    // teste acima passaria de qualquer jeito — foi assim que ele passou com a checagem removida
    await expect(
      applyToConversation({
        orgId,
        conversationId: conversa.id,
        clientId: null,
        ambiguous: false,
        suggestedName: "Direto",
        phone: "554398414905",
      }),
    ).resolves.toMatchObject({ dealId: null });
  });

  it("roleta desligada cria o lead sem dono", async () => {
    await configurar({ autoAssign: false });

    await post(evento());

    const lead = await leadDaConversa();
    expect(lead).not.toBeNull();
    // lead sem responsável aparece na tela e alguém pega; lead que não existe, não
    expect(lead?.ownerId).toBeNull();
  });

  it("perfil sem nome cai no telefone, não em texto genérico", async () => {
    await configurar();

    await post(evento({ wa_name: null, wa_contactName: null, lead_name: null }));

    expect((await leadDaConversa())?.name).toBe("(43) 9841-4904");
  });
});
