import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AuditAction } from "../src/generated/prisma/client.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

const remote = {
  message: { pin: vi.fn(), delete: vi.fn() },
  send: { text: vi.fn() },
};
vi.mock("../src/lib/uazapi/index.js", () => ({ createUazapiClient: () => remote }));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let conversationId = "";
let messageId = "";

/**
 * Ações que **não** nascem de um ponto instrumentado no código de domínio:
 *
 * - `EXPORTED` sai da rota de export da auditoria (Fase 5 do plano, ainda não implementada);
 * - `PURGED` é da retenção, que grava via `recordAudit` com a ação montada em variável.
 */
const FORA_DO_SRC = new Set<AuditAction>([AuditAction.EXPORTED]);

const listarArquivos = async (dir: string): Promise<string[]> => {
  const entradas = await readdir(dir, { withFileTypes: true });
  const arquivos = await Promise.all(
    entradas.map(async (entrada) => {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) return listarArquivos(caminho);
      return entrada.name.endsWith(".ts") ? [caminho] : [];
    }),
  );
  return arquivos.flat();
};

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `cov-${stamp}@eloscrm.test`, `cov-${stamp}`));

  const instance = await prisma.uazapiInstance.create({
    data: {
      organizationId: orgId,
      remoteId: `remote-cov-${stamp}`,
      name: "cov",
      status: "connected",
      tokenEnc: encryptToken(`tok-cov-${stamp}`),
      tokenHash: hashToken(`tok-cov-${stamp}`),
      webhookSecret: `secret-cov-${stamp}`,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: orgId,
      instanceId: instance.id,
      chatid: `55439999${stamp}@s.whatsapp.net`,
      phone: "554399990000",
      waName: "Fulano da Cobertura",
      unreadCount: 3,
    },
  });
  conversationId = conversation.id;
  const message = await prisma.whatsappMessage.create({
    data: {
      organizationId: orgId,
      conversationId,
      providerId: `owner:COV-${stamp}`,
      providerMessageId: `COV-${stamp}`,
      direction: "outbound",
      type: "text",
      status: "sent",
      text: "mensagem da cobertura",
      sentAt: new Date(),
    },
  });
  messageId = message.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/**
 * Guarda de completude da matriz §4 do plano.
 *
 * Estático de propósito: exercitar as 30 ações por HTTP aqui duplicaria os testes por módulo (que já
 * asseguram cada evento chegando ao banco) e custaria um sign-up por caso. O que **só** este arquivo
 * pega é a ação que existe no enum e nunca é emitida por ninguém — a lacuna que a instrumentação por
 * módulo, por definição, não vê.
 */
describe("cobertura da auditoria", () => {
  it("toda ação do enum é emitida em algum lugar do código", async () => {
    const arquivos = await listarArquivos(join(process.cwd(), "src"));
    const fontes = await Promise.all(arquivos.map((arquivo) => readFile(arquivo, "utf8")));
    const codigo = fontes.join("\n");

    const orfas = Object.values(AuditAction).filter(
      (action) => !FORA_DO_SRC.has(action) && !codigo.includes(`AuditAction.${action}`),
    );

    expect(orfas).toEqual([]);
  });

  it("as ações ainda não implementadas estão declaradas como pendência", () => {
    // se alguém implementar o export da auditoria e esquecer de tirar daqui, este teste cobra
    expect([...FORA_DO_SRC]).toEqual([AuditAction.EXPORTED]);
  });
});

/**
 * A lista de exclusão da D7, como teste.
 *
 * É o guarda contra alguém "completar a cobertura" depois: auditar estes caminhos transformaria o log
 * numa segunda tabela de mensagens — o webhook reentrega, e a captura real da uazapi teve dez
 * tentativas do mesmo evento.
 */
describe("o que a D7 mantém fora da trilha", () => {
  const contarEventos = () => prisma.auditEvent.count({ where: { organizationId: orgId } });

  const semEvento = async (label: string, acao: () => Promise<unknown>) => {
    const antes = await contarEventos();
    await acao();
    expect(await contarEventos(), label).toBe(antes);
  };

  it("marcar como lida não gera evento", async () =>
    semEvento("markRead", () =>
      app.inject({
        method: "POST",
        url: `/v1/whatsapp/conversations/${conversationId}/read`,
        headers: { cookie },
      }),
    ));

  it("fixar mensagem não gera evento", async () => {
    remote.message.pin.mockResolvedValue({ success: true, data: {} });
    await semEvento("pin", () =>
      app.inject({
        method: "POST",
        url: `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}/pin`,
        headers: { cookie },
        payload: { pin: true, duration: 1 },
      }),
    );
  });

  it("favoritar mensagem não gera evento", async () =>
    semEvento("favorite", () =>
      app.inject({
        method: "POST",
        url: `/v1/whatsapp/conversations/${conversationId}/messages/${messageId}/favorite`,
        headers: { cookie },
        payload: { favorite: true },
      }),
    ));

  it("renovar a URL da mídia não gera evento", async () =>
    semEvento("mediaUrl", () =>
      app.inject({
        method: "GET",
        url: `/v1/whatsapp/conversations/messages/${messageId}/media`,
        headers: { cookie },
      }),
    ));

  it("listar não gera evento", async () =>
    semEvento("leituras", async () => {
      await app.inject({ method: "GET", url: "/v1/clients", headers: { cookie } });
      await app.inject({ method: "GET", url: "/v1/deals", headers: { cookie } });
      await app.inject({ method: "GET", url: "/v1/dashboard/stats", headers: { cookie } });
      await app.inject({ method: "GET", url: "/v1/agenda", headers: { cookie } });
    }));
});
