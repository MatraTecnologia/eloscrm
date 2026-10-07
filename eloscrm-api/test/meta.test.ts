import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signIn, signUp, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { MetaGraphError } from "../src/lib/meta/graph.js";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "../src/lib/crypto.js";
import * as metaRepo from "../src/modules/meta/meta.repo.js";

// A Graph API é serviço de terceiro: mockar o client é a única forma de exercitar o fluxo sem token
// real. O banco segue real, como no resto da suíte.
const remote = {
  me: vi.fn(),
  pages: vi.fn(),
  leadForms: vi.fn(),
  leads: vi.fn(),
};

vi.mock("../src/lib/meta/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/meta/index.js")>()),
  createMetaGraphClient: () => remote,
}));

let app: FastifyInstance;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let cookie = "";
let orgId = "";
let memberCookie = "";
let otherCookie = "";
const TOKEN = "EAAB-token-de-teste-com-tamanho-suficiente";

type Pipeline = { id: string; stages: { id: string }[] };

beforeAll(async () => {
  app = await makeApp();
  ({ cookie, orgId } = await signUpWithOrg(app, `meta-${stamp}@eloscrm.test`, `meta-${stamp}`));
  ({ cookie: otherCookie } = await signUpWithOrg(app, `meta-b-${stamp}@eloscrm.test`, `meta-b-${stamp}`));

  const memberEmail = `meta-m-${stamp}@eloscrm.test`;
  await signUp(app, memberEmail);
  const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
  await prisma.member.create({
    data: { organizationId: orgId, userId: member.id, role: "member", createdAt: new Date() },
  });
  memberCookie = await signIn(app, memberEmail);
  await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { cookie: memberCookie },
    payload: { organizationId: orgId },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  remote.me.mockResolvedValue({ id: "100", name: "Fulano" });
  remote.pages.mockResolvedValue([{ id: "p1", name: "Página Imob", access_token: "page-token-1" }]);
  remote.leadForms.mockResolvedValue([{ id: "f1", name: "Form Lançamento", status: "ACTIVE" }]);
  remote.leads.mockResolvedValue([]);
  await prisma.metaIntegration.deleteMany({ where: { organizationId: orgId } });
  await prisma.metaLead.deleteMany({ where: { organizationId: orgId } });
  await prisma.deal.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
});

const get = (c = cookie) => app.inject({ method: "GET", url: "/v1/meta/integration", headers: { cookie: c } });

const connect = (c = cookie, payload: Record<string, unknown> = { token: TOKEN, tokenType: "user" }) =>
  app.inject({ method: "POST", url: "/v1/meta/integration", headers: { cookie: c }, payload });

const funil = async (): Promise<Pipeline> => {
  const res = await app.inject({ method: "GET", url: "/v1/pipelines", headers: { cookie } });
  return res.json()[0];
};

const leadNode = (id: string, phone = "+5543999140409") => ({
  id,
  created_time: new Date().toISOString(),
  field_data: [
    { name: "full_name", values: ["Maria Silva"] },
    { name: "email", values: ["maria@example.com"] },
    { name: "phone_number", values: [phone] },
    { name: "bairro_de_interesse", values: ["Gleba Palhano"] },
  ],
  campaign_name: "Lançamento Verão",
  ad_name: "Anúncio 1",
  platform: "fb",
});

describe("integração com o Meta", () => {
  it("sem integração devolve null", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it("conecta validando o token e importando páginas e formulários, sem expor o token", async () => {
    const res = await connect();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.metaUserName).toBe("Fulano");
    expect(body.tokenLast4).toBe(TOKEN.slice(-4));
    expect(body.pages).toEqual([expect.objectContaining({ pageId: "p1", name: "Página Imob" })]);
    expect(body.forms).toHaveLength(1);
    expect(body.forms[0]).toMatchObject({ formId: "f1", name: "Form Lançamento", enabled: false });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain("page-token-1");
    expect(remote.leadForms).toHaveBeenCalledWith("p1", "page-token-1");
  });

  it("corretor não conecta", async () => {
    const res = await connect(memberCookie);
    expect(res.statusCode).toBe(403);
  });

  it("usa o token do sistema quando a página não retorna token próprio", async () => {
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página Imob" }]);
    const res = await connect(cookie, { token: TOKEN, tokenType: "system_user" });
    expect(res.statusCode).toBe(201);
    expect(remote.leadForms).toHaveBeenCalledWith("p1", TOKEN);
    const page = await prisma.metaPage.findFirstOrThrow({ where: { integration: { organizationId: orgId }, pageId: "p1" } });
    expect(decryptToken(page.tokenEnc)).toBe(TOKEN);
    expect(res.body).not.toContain(TOKEN);
  });

  it("preserva token próprio nas páginas que o retornam ao usuário do sistema", async () => {
    const pageToken = randomBytes(24).toString("base64url");
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página Imob", access_token: pageToken }, { id: "p2", name: "Outra página" }]);
    remote.leadForms.mockImplementation(async (pageId: string) => [{ id: `form-${pageId}`, name: "Formulário fictício" }]);
    const res = await connect(cookie, { token: TOKEN, tokenType: "system_user" });
    expect(res.statusCode).toBe(201);
    expect(remote.leadForms).toHaveBeenCalledWith("p1", pageToken);
    expect(remote.leadForms).toHaveBeenCalledWith("p2", TOKEN);
    expect(res.json().forms).toHaveLength(2);
  });

  it("recusa token de usuário sem token de página e não grava integração parcial", async () => {
    const pageToken = randomBytes(24).toString("base64url");
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página Imob", access_token: pageToken }, { id: "p2", name: "Outra página" }]);
    const res = await connect();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("META_PAGE_TOKEN_MISSING");
    expect((await get()).json()).toBeNull();
    expect(res.body).not.toContain(TOKEN);
    expect(res.body).not.toContain(pageToken);
  });

  it("não troca a conexão existente quando o token novo não acessa formulários", async () => {
    await connect();
    const before = await prisma.metaIntegration.findUniqueOrThrow({ where: { organizationId: orgId }, include: { pages: true, forms: true } });
    remote.pages.mockResolvedValue([{ id: "p2", name: "Outra página" }]);
    remote.leadForms.mockRejectedValue(new MetaGraphError({ code: 200, message: "Permissão ausente" }, false));
    const res = await connect(cookie, { token: randomBytes(24).toString("base64url"), tokenType: "system_user" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("META_PAGE_ACCESS_DENIED");
    const after = await prisma.metaIntegration.findUniqueOrThrow({ where: { organizationId: orgId }, include: { pages: true, forms: true } });
    expect(after.tokenEnc).toBe(before.tokenEnc);
    expect(after.pages).toEqual(before.pages);
    expect(after.forms).toEqual(before.forms);
  });

  it("conecta páginas autorizadas e mantém aviso das páginas recusadas sem expor o token", async () => {
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página autorizada" }, { id: "p2", name: "Página sem acesso" }]);
    remote.leadForms.mockImplementation(async (pageId: string) => {
      if (pageId === "p2") throw new MetaGraphError({ code: 10, message: "User has insufficient privileges on the page." }, false);
      return [{ id: "f1", name: "Formulário fictício" }];
    });
    const res = await connect(cookie, { token: TOKEN, tokenType: "system_user" });
    expect(res.statusCode).toBe(201);
    expect(res.json().pages).toEqual([expect.objectContaining({ pageId: "p1" })]);
    expect(res.json().forms).toHaveLength(1);
    expect(res.json().connectionWarning).toContain('"Página sem acesso" (ID p2)');
    expect(res.body).not.toContain(TOKEN);
    expect((await get()).json().connectionWarning).toBe(res.json().connectionWarning);
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página autorizada" }, { id: "p2", name: "Página sem acesso" }]);
    remote.leadForms.mockImplementation(async (pageId: string) => [{ id: `form-${pageId}`, name: "Formulário fictício" }]);
    const restored = await connect(cookie, { token: TOKEN, tokenType: "system_user" });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().connectionWarning).toBeNull();
    expect(restored.json().pages).toHaveLength(2);
  });

  it("recusa conexão quando nenhuma página permite acesso aos formulários", async () => {
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página sem acesso" }]);
    remote.leadForms.mockRejectedValue(new MetaGraphError({ code: 10, message: "User has insufficient privileges on the page." }, false));
    const res = await connect(cookie, { token: TOKEN, tokenType: "system_user" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("META_PAGE_ACCESS_DENIED");
    expect(res.json().error.message).toContain('"Página sem acesso" (ID p1)');
    expect(res.body).not.toContain(TOKEN);
    expect((await get()).json()).toBeNull();
  });

  it("não ignora falhas de rede como se fossem falta de permissão", async () => {
    remote.pages.mockResolvedValue([{ id: "p1", name: "Página autorizada" }, { id: "p2", name: "Página indisponível" }]);
    remote.leadForms.mockImplementation(async (pageId: string) => {
      if (pageId === "p2") throw new MetaGraphError(null, true);
      return [{ id: "f1", name: "Formulário fictício" }];
    });
    const res = await connect(cookie, { token: TOKEN, tokenType: "system_user" });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe("META_UNAVAILABLE");
    expect((await get()).json()).toBeNull();
  });

  it("recusa resposta de formulário inválida sem salvar a conexão", async () => {
    remote.leadForms.mockResolvedValue([{ id: "f1", name: null }]);
    const res = await connect();
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("META_RESPONSE_INVALID");
    expect((await get()).json()).toBeNull();
  });

  it("reverte integração e páginas quando a gravação de formulário falha", async () => {
    await expect(metaRepo.saveConnection(orgId, { tokenType: "system_user", tokenEnc: encryptToken(TOKEN), tokenLast4: TOKEN.slice(-4), metaUserId: "fixture-user", metaUserName: "Usuário fictício" }, [{ pageId: "p1", name: "Página fictícia", tokenEnc: encryptToken(TOKEN), forms: [{ id: "f1", name: null as unknown as string }] }])).rejects.toThrow();
    expect((await get()).json()).toBeNull();
    expect(await prisma.metaPage.count({ where: { integration: { organizationId: orgId } } })).toBe(0);
  });

  it("token recusado pelo Meta é 422", async () => {
    remote.me.mockRejectedValue(new MetaGraphError({ message: "Invalid OAuth access token", code: 190 }, false));
    const res = await connect();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("META_TOKEN_INVALID");
  });

  it("token sem página é recusado", async () => {
    remote.pages.mockResolvedValue([]);
    const res = await connect();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("META_NO_PAGES");
  });

  it("outra imobiliária não vê nem altera", async () => {
    await connect();
    const formId = (await get()).json().forms[0].id;
    expect((await get(otherCookie)).json()).toBeNull();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meta/integration/forms/${formId}`,
      headers: { cookie: otherCookie },
      payload: { enabled: true, pipelineId: null, stageId: null },
    });
    expect(res.statusCode).toBe(404);
  });

  it("destino exige funil e estágio da própria imobiliária", async () => {
    await connect();
    const meio = await app.inject({
      method: "PATCH",
      url: "/v1/meta/integration",
      headers: { cookie },
      payload: { pipelineId: "x", stageId: null },
    });
    expect(meio.statusCode).toBe(422);

    const { id, stages } = await funil();
    const ok = await app.inject({
      method: "PATCH",
      url: "/v1/meta/integration",
      headers: { cookie },
      payload: { pipelineId: id, stageId: stages[0]!.id },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ pipelineId: id, stageId: stages[0]!.id });
  });

  it("ligar o formulário marca a água em agora", async () => {
    await connect();
    const formId = (await get()).json().forms[0].id;
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meta/integration/forms/${formId}`,
      headers: { cookie },
      payload: { enabled: true, pipelineId: null, stageId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().forms[0].enabled).toBe(true);
    expect(res.json().forms[0].lastLeadAt).not.toBeNull();
  });

  it("sync cria lead e negócio no estágio configurado, uma vez só", async () => {
    await connect();
    const { id: pipelineId, stages } = await funil();
    await app.inject({
      method: "PATCH",
      url: "/v1/meta/integration",
      headers: { cookie },
      payload: { pipelineId, stageId: stages[0]!.id },
    });
    const formId = (await get()).json().forms[0].id;
    await app.inject({
      method: "PATCH",
      url: `/v1/meta/integration/forms/${formId}`,
      headers: { cookie },
      payload: { enabled: true, pipelineId: null, stageId: null },
    });
    remote.leads.mockResolvedValue([leadNode("lead-1")]);

    const first = await app.inject({ method: "POST", url: "/v1/meta/integration/sync", headers: { cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.json().ingested).toBe(1);

    const client = await prisma.client.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(client).toMatchObject({
      name: "Maria Silva",
      email: "maria@example.com",
      source: "META",
      description: "bairro_de_interesse: Gleba Palhano",
    });
    expect(client.phone).toContain("99914-0409");
    const deal = await prisma.deal.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(deal).toMatchObject({ clientId: client.id, pipelineId, stageId: stages[0]!.id });

    // mesma janela de novo: nada duplica
    const second = await app.inject({ method: "POST", url: "/v1/meta/integration/sync", headers: { cookie } });
    expect(second.json().ingested).toBe(0);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.deal.count({ where: { organizationId: orgId } })).toBe(1);

    const leads = await app.inject({ method: "GET", url: "/v1/meta/integration/leads", headers: { cookie } });
    expect(leads.json()).toHaveLength(1);
    expect(leads.json()[0]).toMatchObject({ leadgenId: "lead-1", clientId: client.id, dealId: deal.id });
  });

  it("lead com telefone já cadastrado reaproveita a ficha", async () => {
    await connect();
    const existente = await prisma.client.create({
      data: { organizationId: orgId, name: "Maria Antiga", phone: "(43) 99914-0409", phoneKey: "4399140409" },
    });
    const formId = (await get()).json().forms[0].id;
    await app.inject({
      method: "PATCH",
      url: `/v1/meta/integration/forms/${formId}`,
      headers: { cookie },
      payload: { enabled: true, pipelineId: null, stageId: null },
    });
    remote.leads.mockResolvedValue([leadNode("lead-2")]);

    await app.inject({ method: "POST", url: "/v1/meta/integration/sync", headers: { cookie } });
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1);
    const lead = await prisma.metaLead.findUniqueOrThrow({ where: { leadgenId: "lead-2" } });
    expect(lead.clientId).toBe(existente.id);
  });

  it("token que morreu desliga a integração", async () => {
    await connect();
    const formId = (await get()).json().forms[0].id;
    await app.inject({
      method: "PATCH",
      url: `/v1/meta/integration/forms/${formId}`,
      headers: { cookie },
      payload: { enabled: true, pipelineId: null, stageId: null },
    });
    remote.leads.mockRejectedValue(new MetaGraphError({ message: "expired", code: 190 }, false));

    const res = await app.inject({ method: "POST", url: "/v1/meta/integration/sync", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().integration.status).toBe("token_invalid");
    expect(res.json().integration.lastError).toBe("expired");
  });

  it("desconectar apaga a integração", async () => {
    await connect();
    const res = await app.inject({ method: "DELETE", url: "/v1/meta/integration", headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect((await get()).json()).toBeNull();
  });
});
