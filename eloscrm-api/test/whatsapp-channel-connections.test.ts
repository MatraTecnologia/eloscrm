import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { prisma } from "../src/lib/prisma.js";
import * as service from "../src/modules/channel-connections/channel-connections.service.js";

let app: FastifyInstance;
let orgA: string;
let orgB: string;
let cookieA: string;
let cookieB: string;
let fixture: Awaited<ReturnType<typeof createOfficialConnectionFixture>>;
const stamp = `${process.pid}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  app = await makeApp();
  ({ orgId: orgA, cookie: cookieA } = await signUpWithOrg(app, `channel-a-${stamp}@eloscrm.test`, `channel-a-${stamp}`));
  ({ orgId: orgB, cookie: cookieB } = await signUpWithOrg(app, `channel-b-${stamp}@eloscrm.test`, `channel-b-${stamp}`));
  fixture = await createOfficialConnectionFixture(orgA);
});

afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe("conexões de WhatsApp por imobiliária", () => {
  it("exige sessão nas rotas e não expõe credenciais", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/connections" })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/v1/whatsapp/connections", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({ id: fixture.connection.id, provider: "cloud_api" })]);
    expect(response.body).not.toContain(fixture.accessToken);
    expect(response.body).not.toContain("tokenEnc");
  });

  it("outra imobiliária não lista nem acessa a conexão ou a credencial", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/whatsapp/connections", headers: { cookie: cookieB } });
    expect(list.json()).toEqual([]);
    const detail = await app.inject({ method: "GET", url: `/v1/whatsapp/connections/${fixture.connection.id}`, headers: { cookie: cookieB } });
    expect(detail.statusCode).toBe(404);
    await expect(service.getOfficialCredentials(orgB, fixture.connection.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.disable(orgB, fixture.connection.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("cifra no banco e só libera a credencial pelo escopo autorizado", async () => {
    const stored = await prisma.channelConnection.findFirstOrThrow({ where: { id: fixture.connection.id, organizationId: orgA } });
    expect(stored.tokenEnc).not.toBe(fixture.accessToken);
    expect((await service.getOfficialCredentials(orgA, fixture.connection.id)).accessToken).toBe(fixture.accessToken);
  });

  it("não permite cadastrar o mesmo número em outra imobiliária", async () => {
    await expect(service.saveVerifiedOfficialConnection(orgB, fixture.input)).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_UNAVAILABLE" });
    expect((await service.getOfficialCredentials(orgA, fixture.connection.id)).accessToken).toBe(fixture.accessToken);
  });

  it("renova o token preservando a conexão e recusa alteração de portfolio", async () => {
    const current = await createOfficialConnectionFixture(orgA);
    const nextToken = randomBytes(24).toString("base64url");
    const renewed = await service.saveVerifiedOfficialConnection(orgA, { ...current.input, accessToken: nextToken });
    expect(renewed.id).toBe(current.connection.id);
    expect((await service.getOfficialCredentials(orgA, renewed.id)).accessToken).toBe(nextToken);
    await expect(service.saveVerifiedOfficialConnection(orgA, { ...current.input, businessPortfolioId: "123" })).rejects.toMatchObject({ code: "WHATSAPP_ASSET_CHANGED" });
  });

  it("não libera token expirado nem credencial desativada", async () => {
    const expired = await createOfficialConnectionFixture(orgA, { tokenExpiresAt: new Date(0) });
    await expect(service.getOfficialCredentials(orgA, expired.connection.id)).rejects.toMatchObject({ code: "WHATSAPP_TOKEN_EXPIRED" });
    await service.disable(orgA, expired.connection.id);
    await expect(service.getOfficialCredentials(orgA, expired.connection.id)).rejects.toMatchObject({ code: "WHATSAPP_CONNECTION_UNAVAILABLE" });
    expect((await prisma.channelConnection.findFirstOrThrow({ where: { id: expired.connection.id, organizationId: orgA } })).tokenEnc).toBeNull();
  });

  it("recusa campos adicionais no contrato interno", async () => {
    await expect(service.saveVerifiedOfficialConnection(orgA, { ...fixture.input, organizationId: orgB } as typeof fixture.input)).rejects.toThrow();
  });
});
