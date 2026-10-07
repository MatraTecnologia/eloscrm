import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { resolveContactIdentity, linkContactToClient } from "../src/modules/contact-identities/contact-identities.service.js";
import { disable } from "../src/modules/channel-connections/channel-connections.service.js";
import { encryptToken, hashToken } from "../src/lib/crypto.js";

let orgA: string;
let orgB: string;
let connectionA: string;
let connectionB: string;
let connectionOtherPortfolio: string;

beforeAll(async () => {
  const orgs = await Promise.all(["a", "b"].map(suffix => prisma.organization.create({
    data: { name: `Imobiliária ${suffix}`, slug: `identity-${suffix}-${randomUUID()}` },
  })));
  orgA = orgs[0]!.id;
  orgB = orgs[1]!.id;
  const sharedPortfolio = "87654321";
  connectionA = (await createOfficialConnectionFixture(orgA, { businessPortfolioId: sharedPortfolio })).connection.id;
  connectionB = (await createOfficialConnectionFixture(orgB, { businessPortfolioId: sharedPortfolio })).connection.id;
  connectionOtherPortfolio = (await createOfficialConnectionFixture(orgA, { businessPortfolioId: "87654322" })).connection.id;
});

afterAll(async () => { await prisma.$disconnect(); });

const resolve = (orgId: string, connectionId: string, value: string) => resolveContactIdentity(orgId, { connectionId, kind: "bsuid", value });

describe("identidades de contato de WhatsApp", () => {
  it("recebe BSUID sem telefone e mantém o mesmo contato em reentregas", async () => {
    const value = randomUUID();
    const first = await resolve(orgA, connectionA, value);
    const second = await resolve(orgA, connectionA, value);
    expect(second.id).toBe(first.id);
    expect(first.clientId).toBeNull();
    expect(await prisma.contactIdentity.count({ where: { organizationId: orgA, value } })).toBe(1);
  });

  it("não une identidades iguais de imobiliárias ou portfolios diferentes", async () => {
    const value = randomUUID();
    const [first, second, third] = await Promise.all([
      resolve(orgA, connectionA, value), resolve(orgB, connectionB, value), resolve(orgA, connectionOtherPortfolio, value),
    ]);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it("resolve concorrência sem deixar contatos órfãos", async () => {
    const before = await prisma.messagingContact.count({ where: { organizationId: orgA } });
    const value = randomUUID();
    const contacts = await Promise.all(Array.from({ length: 4 }, () => resolve(orgA, connectionA, value)));
    expect(new Set(contacts.map(contact => contact.id)).size).toBe(1);
    expect(await prisma.messagingContact.count({ where: { organizationId: orgA } })).toBe(before + 1);
  });

  it("recusa conexão de outra imobiliária e identidade incompatível", async () => {
    await expect(resolve(orgA, connectionB, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
    await expect(resolveContactIdentity(orgA, { connectionId: connectionA, kind: "phone", value: randomUUID() })).rejects.toMatchObject({ code: "WHATSAPP_IDENTITY_INVALID" });
    await expect(resolveContactIdentity(orgA, { connectionId: connectionA, kind: "jid", value: randomUUID() })).rejects.toMatchObject({ code: "WHATSAPP_IDENTITY_INVALID" });
  });

  it("recusa identidade aposentada sem criar novo contato", async () => {
    const value = randomUUID();
    const contact = await resolve(orgA, connectionA, value);
    await prisma.contactIdentity.updateMany({ where: { organizationId: orgA, contactId: contact.id }, data: { validUntil: new Date(0) } });
    await expect(resolve(orgA, connectionA, value)).rejects.toMatchObject({ code: "WHATSAPP_IDENTITY_RETIRED" });
  });

  it("vínculo manual exige cliente e contato da mesma imobiliária", async () => {
    const contact = await resolve(orgA, connectionA, randomUUID());
    const foreign = await prisma.client.create({ data: { organizationId: orgB, name: "Cliente externo" } });
    await expect(linkContactToClient(orgA, contact.id, foreign.id)).rejects.toMatchObject({ statusCode: 404 });
    const local = await prisma.client.create({ data: { organizationId: orgA, name: "Cliente local" } });
    expect((await linkContactToClient(orgA, contact.id, local.id)).clientId).toBe(local.id);
    const another = await resolve(orgA, connectionA, randomUUID());
    await expect(linkContactToClient(orgA, another.id, local.id)).rejects.toMatchObject({ code: "WHATSAPP_CLIENT_ALREADY_LINKED" });
  });

  it("concorrência de vínculo não sobrescreve o cliente vencedor", async () => {
    const contact = await resolve(orgA, connectionA, randomUUID());
    const clients = await Promise.all(["Primeiro", "Segundo"].map(name => prisma.client.create({ data: { organizationId: orgA, name } })));
    const results = await Promise.allSettled(clients.map(client => linkContactToClient(orgA, contact.id, client.id)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find(result => result.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason.code).toBe("WHATSAPP_CONTACT_ALREADY_LINKED");
  });

  it("desativar a conexão preserva identidades e contato", async () => {
    const extra = (await createOfficialConnectionFixture(orgA)).connection;
    const contact = await resolve(orgA, extra.id, randomUUID());
    await disable(orgA, extra.id);
    expect(await prisma.messagingContact.findFirst({ where: { organizationId: orgA, id: contact.id } })).not.toBeNull();
    expect(await prisma.contactIdentity.count({ where: { organizationId: orgA, contactId: contact.id } })).toBe(1);
    await expect(prisma.channelConnection.delete({ where: { id: extra.id, organizationId: orgA } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("o banco também impede uma identidade com conexão de outra imobiliária", async () => {
    const contact = await resolve(orgA, connectionA, randomUUID());
    await expect(prisma.contactIdentity.create({ data: {
      organizationId: orgA, contactId: contact.id, connectionId: connectionB, kind: "bsuid", value: randomUUID(), scope: "invalid-scope", source: "provider",
    } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("a exclusão da organização elimina suas conexões e identidades", async () => {
    const organization = await prisma.organization.create({ data: { name: "Tenant temporário", slug: `purge-identity-${randomUUID()}` } });
    const connection = (await createOfficialConnectionFixture(organization.id)).connection;
    const contact = await resolve(organization.id, connection.id, randomUUID());
    const instanceToken = randomBytes(24).toString("base64url");
    const instance = await prisma.uazapiInstance.create({ data: {
      organizationId: organization.id, remoteId: randomUUID(), name: "Instância de teste",
      tokenEnc: encryptToken(instanceToken), tokenHash: hashToken(instanceToken), webhookSecret: randomBytes(24).toString("base64url"),
    } });
    const residual = await prisma.channelConnection.create({ data: {
      organizationId: organization.id, provider: "uazapi", label: "Canal residual", uazapiInstanceId: instance.id,
    } });
    await resolveContactIdentity(organization.id, { connectionId: residual.id, kind: "lid", value: randomUUID() });
    await prisma.organization.delete({ where: { id: organization.id } });
    expect(await prisma.uazapiInstance.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await prisma.channelConnection.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await prisma.contactIdentity.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await prisma.messagingContact.count({ where: { organizationId: organization.id, id: contact.id } })).toBe(0);
  });
});
