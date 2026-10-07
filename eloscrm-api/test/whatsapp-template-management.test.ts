import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import * as graph from "../src/lib/whatsapp-official/graph.js";

vi.mock("../src/lib/whatsapp-official/graph.js", async importOriginal => ({ ...await importOriginal<typeof graph>(), createTemplate: vi.fn(), deleteTemplate: vi.fn() }));
let app: FastifyInstance;
let orgId: string;
let userId: string;
let cookie: string;
let connectionId: string;
let externalId: string;
const draft = { name: "confirmacao_visita", language: "pt_BR", category: "UTILITY", body: "Olá {{1}}, sua visita está confirmada.", examples: ["Maria"] };
const headers = () => ({ cookie, origin: env.WEB_ORIGIN });
const url = () => `/v1/whatsapp/outbound/connections/${connectionId}/templates`;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  vi.clearAllMocks();
  const suffix = randomUUID();
  ({ orgId, cookie } = await signUpWithOrg(app, `template-${suffix}@eloscrm.test`, `template-${suffix}`));
  userId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId } })).userId;
  connectionId = (await createOfficialConnectionFixture(orgId)).connection.id;
  externalId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  vi.mocked(graph.createTemplate).mockResolvedValue({ id: externalId, status: "PENDING", category: "UTILITY" });
  vi.mocked(graph.deleteTemplate).mockResolvedValue({ success: true });
});
describe("gerenciamento de templates", () => {
  it("cria modelo com exemplos e mantém pendente até aprovação da Meta", async () => {
    const response = await app.inject({ method: "POST", url: url(), headers: headers(), payload: draft });
    expect(response.statusCode).toBe(200);
    expect(graph.createTemplate).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ components: [{ type: "BODY", text: draft.body, example: { body_text: [["Maria"]] } }] }));
    const saved = await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(saved.status).toBe("PENDING");
    expect(response.payload).not.toContain("accessToken");
  });
  it.each([{ ...draft, extra: true }, { ...draft, name: "Nome inválido" }, { ...draft, examples: [] }, { ...draft, body: "Olá {{2}}" }, { ...draft, category: "AUTHENTICATION" }])("rejeita dados inválidos antes de chamar a Meta", async payload => {
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload })).statusCode).toBe(422);
    expect(graph.createTemplate).not.toHaveBeenCalled();
  });
  it("bloqueia corretores e conexões de outra imobiliária", async () => {
    await prisma.member.updateMany({ where: { organizationId: orgId, userId }, data: { role: "member" } });
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: draft })).statusCode).toBe(403);
    await prisma.member.updateMany({ where: { organizationId: orgId, userId }, data: { role: "owner" } });
    connectionId = randomUUID();
    expect((await app.inject({ method: "POST", url: url(), headers: headers(), payload: draft })).statusCode).toBe(404);
    expect(graph.createTemplate).not.toHaveBeenCalled();
  });
  it("exclui somente o ID e idioma selecionados e invalida envios posteriores", async () => {
    const created = (await app.inject({ method: "POST", url: url(), headers: headers(), payload: draft })).json();
    expect((await app.inject({ method: "DELETE", url: `${url()}/${created.id}`, headers: headers() })).statusCode).toBe(200);
    expect(graph.deleteTemplate).toHaveBeenCalledWith(expect.any(String), expect.any(String), externalId, draft.name);
    expect((await prisma.officialTemplate.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("MISSING");
  });
  it("não repete operação com resultado incerto", async () => {
    vi.mocked(graph.createTemplate).mockRejectedValue(new graph.OfficialGraphError(null, true));
    const response = await app.inject({ method: "POST", url: url(), headers: headers(), payload: draft });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.message).toContain("Sincronize");
    expect(graph.createTemplate).toHaveBeenCalledTimes(1);
  });
});
