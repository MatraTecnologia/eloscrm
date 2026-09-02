import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signIn, signUp, signUpWithOrg } from "./helpers/session.js";
import { prisma } from "../src/lib/prisma.js";
import { MetaGraphError } from "../src/lib/meta/graph.js";

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
