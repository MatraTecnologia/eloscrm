import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { renderTemplate } from "../src/modules/broadcasts/template.js";
import { toWaNumber } from "../src/lib/phone.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let cookieB = "";
let pipelineId = "";
let stageA = "";
let stageB = "";
let tagId = "";
let quenteId = "";
let semFoneId = "";
let comValorId = "";
let comTagId = "";
let orgId = "";

type Preview = { dealId: string; sendable: boolean; client: { name: string } };

const headers = () => ({ cookie });

const post = async (url: string, payload: Record<string, unknown>, h = headers()) => {
  const res = await app.inject({ method: "POST", url, headers: h, payload });
  return res;
};

const preview = async (filters: Record<string, unknown>) => {
  const res = await post("/v1/broadcasts/preview", { pipelineId, filters });
  expect(res.statusCode).toBe(200);
  return res.json() as Preview[];
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `bc-a-${stamp}@eloscrm.test`, `bc-a-${stamp}`));
  ({ cookie: cookieB } = await signUpWithOrg(app, `bc-b-${stamp}@eloscrm.test`, `bc-b-${stamp}`));

  const pipelines = await app.inject({ method: "GET", url: "/v1/pipelines", headers: headers() });
  const pipeline = (pipelines.json() as { id: string; stages: { id: string }[] }[])[0];
  pipelineId = pipeline.id;
  stageA = pipeline.stages[0].id;
  stageB = pipeline.stages[1].id;

  tagId = ((await post("/v1/tags", { name: `VIP-${stamp}`, color: "#2563eb" })).json() as { id: string }).id;

  const client = async (name: string, extra: Record<string, unknown>) =>
    ((await post("/v1/clients", { name, ...extra })).json() as { id: string }).id;
  const quente = await client("Ana Quente", { phone: "(43) 99912-3456", temperature: "QUENTE" });
  const semFone = await client("Bruno Sem Fone", {});
  const comValor = await client("Carla Valor", { phone: "43999887766", temperature: "FRIO" });
  const comTag = await client("Dani Tag", { phone: "5543999776655" });

  const deal = async (clientId: string, extra: Record<string, unknown>) =>
    ((await post("/v1/deals", { clientId, title: `D ${stamp}`, pipelineId, stageId: stageA, ...extra })).json() as { id: string }).id;
  quenteId = await deal(quente, {});
  semFoneId = await deal(semFone, { stageId: stageB });
  comValorId = await deal(comValor, { value: 350000 });
  comTagId = await deal(comTag, { tagIds: [tagId] });

  // conversas para o filtro de retorno: Ana recebeu a nossa e não respondeu; Carla respondeu
  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-bc-${stamp}`,
      name: "bc",
      tokenEnc: encryptToken(`tok-bc-${stamp}`),
      tokenHash: hashToken(`tok-bc-${stamp}`),
      webhookSecret: `secret-bc-${stamp}`,
    },
  });
  const conversa = async (clientId: string, phone: string, mensagens: ["inbound" | "outbound", Date][]) => {
    const c = await prisma.conversation.create({
      data: { organizationId: orgId, instanceId: instance.id, chatid: `${phone}@s.whatsapp.net`, phone, clientId },
    });
    for (const [direction, sentAt] of mensagens) {
      await prisma.whatsappMessage.create({
        data: {
          organizationId: orgId,
          conversationId: c.id,
          providerId: `bc-${stamp}-${Math.random()}`,
          direction,
          type: "text",
          text: direction,
          sentAt,
        },
      });
    }
  };
  const dias = (n: number) => new Date(Date.now() - n * 86_400_000);
  await conversa(quente, "5543999123456", [["inbound", dias(10)], ["outbound", dias(5)]]);
  await conversa(comValor, "5543999887766", [["outbound", dias(3)], ["inbound", dias(2)]]);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("toWaNumber", () => {
  it("normaliza para dígitos com DDI", () => {
    expect(toWaNumber("(43) 99912-3456")).toBe("5543999123456");
    expect(toWaNumber("5543999123456")).toBe("5543999123456");
    expect(toWaNumber("4333241234")).toBe("554333241234");
    expect(toWaNumber("1234")).toBeNull();
    expect(toWaNumber(null)).toBeNull();
  });
});

describe("renderTemplate", () => {
  it("troca as variáveis e deixa as desconhecidas visíveis", () => {
    const out = renderTemplate("Oi {{nome}}, sobre {{ titulo }}: {{valor}} {{xpto}}", {
      nome: "Ana",
      nome_completo: "Ana Souza",
      titulo: "Apto Centro",
      valor: "R$ 1,00",
      imovel: "",
      corretor: "",
    });
    expect(out).toBe("Oi Ana, sobre Apto Centro: R$ 1,00 {{xpto}}");
  });
});

describe("broadcasts/preview", () => {
  it("bloqueia sem sessão (401)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/broadcasts/preview", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("sem filtro devolve todo o funil, marcando quem não tem telefone", async () => {
    const rows = await preview({});
    const ids = rows.map((r) => r.dealId);
    expect(ids).toEqual(expect.arrayContaining([quenteId, semFoneId, comValorId, comTagId]));
    expect(rows.find((r) => r.dealId === semFoneId)?.sendable).toBe(false);
    expect(rows.find((r) => r.dealId === quenteId)?.sendable).toBe(true);
  });

  it("filtra por estágio", async () => {
    const ids = (await preview({ stageIds: [stageB] })).map((r) => r.dealId);
    expect(ids).toEqual([semFoneId]);
  });

  it("filtra por etiqueta: tem alguma / não tem nenhuma", async () => {
    expect((await preview({ tagsAny: [tagId] })).map((r) => r.dealId)).toEqual([comTagId]);
    const sem = (await preview({ tagsNone: [tagId] })).map((r) => r.dealId);
    expect(sem).not.toContain(comTagId);
    expect(sem).toContain(quenteId);
  });

  it("filtra por valor preenchido, vazio e faixa", async () => {
    expect((await preview({ value: "FILLED" })).map((r) => r.dealId)).toEqual([comValorId]);
    expect((await preview({ value: "EMPTY" })).map((r) => r.dealId)).not.toContain(comValorId);
    expect((await preview({ valueMin: 400000 })).map((r) => r.dealId)).toEqual([]);
    expect((await preview({ valueMin: 300000, valueMax: 400000 })).map((r) => r.dealId)).toEqual([comValorId]);
  });

  it("filtra por temperatura do lead", async () => {
    expect((await preview({ temperatures: ["QUENTE"] })).map((r) => r.dealId)).toEqual([quenteId]);
  });

  it("filtra por retorno: sem resposta após nosso contato, e com prazo mínimo", async () => {
    expect((await preview({ reply: "NO_REPLY" })).map((r) => r.dealId)).toEqual([quenteId]);
    expect((await preview({ reply: "NO_REPLY", noReplyDays: 3 })).map((r) => r.dealId)).toEqual([quenteId]);
    expect((await preview({ reply: "NO_REPLY", noReplyDays: 7 })).map((r) => r.dealId)).toEqual([]);
    expect((await preview({ reply: "REPLIED" })).map((r) => r.dealId)).toEqual([comValorId]);
  });

  it("recusa faixa invertida (422) e funil de outra imobiliária (404)", async () => {
    const invertida = await post("/v1/broadcasts/preview", { pipelineId, filters: { valueMin: 10, valueMax: 1 } });
    expect(invertida.statusCode).toBe(422);
    const alheio = await post("/v1/broadcasts/preview", { pipelineId, filters: {} }, { cookie: cookieB });
    expect(alheio.statusCode).toBe(404);
  });
});

describe("broadcasts", () => {
  it("não cria disparo sem WhatsApp conectado", async () => {
    const res = await post("/v1/broadcasts", {
      pipelineId,
      filters: {},
      dealIds: [quenteId],
      text: "Oi {{nome}}",
    });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/v1/broadcasts", headers: headers() });
    expect(list.json()).toEqual([]);
  });
});
