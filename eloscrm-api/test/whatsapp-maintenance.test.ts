import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import { saveVerifiedOfficialConnection } from "../src/modules/channel-connections/channel-connections.service.js";
import { linkUazapiConversation } from "../src/modules/whatsapp-maintenance/history.repo.js";
import { removeUazapiInstancePreservingHistory } from "../src/modules/whatsapp-maintenance/lifecycle.repo.js";
import * as graph from "../src/lib/whatsapp-official/graph.js";

let app: FastifyInstance;
let orgId: string;
let cookie: string;
let otherCookie: string;
let otherOrgId: string;
let userId: string;
let instanceId: string;
const oldDate = new Date(Date.now() - 400 * 86_400_000);

beforeAll(async () => {
  app = await makeApp();
  ({ orgId, cookie } = await signUpWithOrg(app, `maintenance-${randomUUID()}@eloscrm.test`, `maintenance-${randomUUID()}`));
  ({ orgId: otherOrgId, cookie: otherCookie } = await signUpWithOrg(app, `maintenance-other-${randomUUID()}@eloscrm.test`, `maintenance-other-${randomUUID()}`));
  userId = (await prisma.member.findFirstOrThrow({ where: { organizationId: orgId } })).userId;
  const instance = await prisma.uazapiInstance.create({ data: { organizationId: orgId, remoteId: randomUUID(), name: "Instância de teste", tokenEnc: randomBytes(32).toString("hex"), tokenHash: randomUUID(), webhookSecret: randomUUID(), status: "connected" } });
  instanceId = instance.id;
});
afterAll(async () => { vi.restoreAllMocks(); await app.close(); await prisma.$disconnect(); });

const post = (path: string, payload: Record<string, unknown>, session = cookie) => app.inject({ method: "POST", url: `/v1/whatsapp/maintenance/${path}`, headers: { cookie: session }, payload });
const legacyThread = (extra: Record<string, unknown> = {}) => prisma.conversation.create({ data: { organizationId: orgId, instanceId, chatid: `${randomUUID()}@s.whatsapp.net`, ...extra } });

describe("manutenção do WhatsApp", () => {
  it("exige sessão e papel de gestor, rejeita campos extras e não toca outra imobiliária", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/whatsapp/maintenance/history", payload: {} })).statusCode).toBe(401);
    expect((await post("history", { apply: false, organizationId: otherOrgId })).statusCode).toBe(422);
    await prisma.member.updateMany({ where: { organizationId: otherOrgId }, data: { role: "member" } });
    expect((await post("history", {}, otherCookie)).statusCode).toBe(403);
    expect(await linkUazapiConversation(otherOrgId, (await legacyThread()).id)).toMatchObject({ status: "unavailable" });
  });

  it("dry-run não grava; aplicar preserva IDs, mensagens e dono, e é idempotente", async () => {
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Lead de teste", ownerId: userId } });
    const thread = await legacyThread({ clientId: client.id });
    const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, conversationId: thread.id, providerId: randomUUID(), direction: "inbound", type: "text", text: "Texto fictício", sentAt: new Date() } });
    const preview = await post("history", {});
    expect(preview.statusCode).toBe(200);
    expect(preview.json().apply).toBe(false);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: thread.id } })).connectionId).toBeNull();
    expect(await prisma.channelConnection.count({ where: { organizationId: orgId, provider: "uazapi" } })).toBe(0);
    expect((await post("history", { apply: true })).statusCode).toBe(200);
    const first = await prisma.conversation.findUniqueOrThrow({ where: { id: thread.id } });
    expect(first.connectionId).toBeTruthy();
    expect(first.messagingContactId).toBeTruthy();
    await linkUazapiConversation(orgId, thread.id);
    const second = await prisma.conversation.findUniqueOrThrow({ where: { id: thread.id } });
    expect(second.messagingContactId).toBe(first.messagingContactId);
    expect((await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } })).connectionId).toBe(first.connectionId);
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).ownerId).toBe(userId);
  });

  it("não funde números iguais nem cria pessoa para grupo; vínculo explícito conflitante exige revisão", async () => {
    const first = await legacyThread({ phoneKey: "5543999998888" });
    const second = await legacyThread({ phoneKey: "5543999998888" });
    const group = await legacyThread({ isGroup: true, phoneKey: "5543999998888" });
    await linkUazapiConversation(orgId, first.id);
    await linkUazapiConversation(orgId, second.id);
    await linkUazapiConversation(orgId, group.id);
    const threads = await prisma.conversation.findMany({ where: { organizationId: orgId, id: { in: [first.id, second.id, group.id] } } });
    expect(threads.find(row => row.id === first.id)!.messagingContactId).not.toBe(threads.find(row => row.id === second.id)!.messagingContactId);
    expect(threads.find(row => row.id === group.id)!.messagingContactId).toBeNull();
    const client = await prisma.client.create({ data: { organizationId: orgId, name: "Vínculo existente" } });
    const canonical = await prisma.messagingContact.create({ data: { organizationId: orgId, clientId: client.id } });
    await prisma.conversation.update({ where: { id: first.id }, data: { clientId: client.id } });
    await expect(linkUazapiConversation(orgId, first.id)).rejects.toMatchObject({ code: "UAZAPI_HISTORY_IDENTITY_CONFLICT" });
    expect((await prisma.messagingContact.findUniqueOrThrow({ where: { id: canonical.id } })).clientId).toBe(client.id);
  });

  it("desativa localmente, revoga token, cancela pendentes e mantém submissões incertas; reconectar mantém histórico", async () => {
    const send = vi.spyOn(graph, "sendMessage").mockRejectedValue(new Error("Não chamar Graph"));
    const fixture = await createOfficialConnectionFixture(orgId);
    const contact = await prisma.messagingContact.create({ data: { organizationId: orgId } });
    const thread = await prisma.conversation.create({ data: { organizationId: orgId, connectionId: fixture.connection.id, messagingContactId: contact.id, chatid: randomUUID() } });
    const commands = [];
    for (const status of ["pending", "preparing", "sending"] as const) {
      const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, conversationId: thread.id, connectionId: fixture.connection.id, providerId: randomUUID(), direction: "outbound", type: "text", status: "pending", sentAt: new Date() } });
      commands.push(await prisma.officialSendCommand.create({ data: { id: randomUUID(), organizationId: orgId, connectionId: fixture.connection.id, messageId: message.id, actorUserId: userId, identityId: randomUUID(), idempotencyKey: randomUUID(), requestHash: randomUUID(), request: {}, payload: {}, status, leaseToken: status === "pending" ? null : randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000) } }));
    }
    expect((await post(`connections/${fixture.connection.id}/disable`, {})).statusCode).toBe(422);
    expect((await post(`connections/${fixture.connection.id}/disable`, { confirm: "DISABLE_LOCAL" }, otherCookie)).statusCode).toBe(403);
    const disabled = await post(`connections/${fixture.connection.id}/disable`, { confirm: "DISABLE_LOCAL" });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ canceledCommands: 2, uncertainCommands: 1, remoteDisconnected: false });
    expect((await prisma.channelConnection.findUniqueOrThrow({ where: { id: fixture.connection.id } })).tokenEnc).toBeNull();
    expect((await prisma.officialSendCommand.findUniqueOrThrow({ where: { id: commands[1]!.id } })).leaseToken).toBeNull();
    const uncertain = await prisma.officialSendCommand.findUniqueOrThrow({ where: { id: commands[2]!.id } });
    expect(uncertain.status).toBe("uncertain");
    expect(uncertain.leaseToken).toBe(commands[2]!.leaseToken);
    expect(send).not.toHaveBeenCalled();
    expect((await saveVerifiedOfficialConnection(orgId, fixture.input)).id).toBe(fixture.connection.id);
    expect(await prisma.conversation.count({ where: { id: thread.id, organizationId: orgId } })).toBe(1);
    await expect(saveVerifiedOfficialConnection(otherOrgId, fixture.input)).rejects.toMatchObject({ code: "WHATSAPP_NUMBER_UNAVAILABLE" });
  });

  it("expurga só payload processado antigo e mantém dedup, recuperação e histórico", async () => {
    const fixture = await createOfficialConnectionFixture(orgId);
    const thread = await prisma.conversation.create({ data: { organizationId: orgId, connectionId: fixture.connection.id, chatid: randomUUID() } });
    const commands = [];
    for (const status of ["accepted", "failed", "uncertain"] as const) {
      const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, conversationId: thread.id, connectionId: fixture.connection.id, providerId: randomUUID(), direction: "outbound", type: "text", text: "Histórico preservado", sentAt: oldDate } });
      commands.push(await prisma.officialSendCommand.create({ data: { id: randomUUID(), organizationId: orgId, connectionId: fixture.connection.id, messageId: message.id, actorUserId: userId, identityId: randomUUID(), idempotencyKey: randomUUID(), requestHash: randomUUID(), request: { private: "Conteúdo fictício" }, payload: { text: "Conteúdo fictício" }, status, updatedAt: oldDate } }));
    }
    const events = [];
    for (const status of ["processed", "failed", "unresolved", "pending"] as const) events.push(await prisma.officialWebhookEvent.create({ data: { dedupKey: randomUUID(), organizationId: orgId, connectionId: fixture.connection.id, wabaId: fixture.input.wabaId, field: "messages", status, payload: { private: "Conteúdo fictício" }, receivedAt: oldDate, processedAt: status === "processed" ? oldDate : null } }));
    const preview = await post("retention", {});
    expect(preview.statusCode).toBe(200);
    expect(preview.json().journalPayloads).toBe(1);
    expect(preview.json().commandPayloads).toBe(2);
    expect((await prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: events[0]!.id } })).payloadPurgedAt).toBeNull();
    expect((await post("retention", { apply: true })).json().journalPayloads).toBe(1);
    const purged = await prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: events[0]!.id } });
    expect(purged.payload).toEqual({});
    expect(purged.dedupKey).toBe(events[0]!.dedupKey);
    expect(purged.status).toBe("processed");
    expect(purged.payloadPurgedAt).toBeInstanceOf(Date);
    for (const command of commands.slice(0, 2)) {
      const saved = await prisma.officialSendCommand.findUniqueOrThrow({ where: { id: command.id } });
      expect(saved.payload).toEqual({});
      expect(saved.requestHash).toBe(command.requestHash);
      expect(saved.idempotencyKey).toBe(command.idempotencyKey);
      expect((await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: command.messageId } })).text).toBe("Histórico preservado");
    }
    expect((await prisma.officialSendCommand.findUniqueOrThrow({ where: { id: commands[2]!.id } })).payload).toEqual(commands[2]!.payload);
    for (const event of events.slice(1)) expect((await prisma.officialWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).payload).toEqual(event.payload);
    expect((await post("retention", { apply: true })).json().journalPayloads).toBe(0);
  });

  it("remover a instância desativa a conexão histórica e preserva mensagens e contatos", async () => {
    const thread = await legacyThread();
    await linkUazapiConversation(orgId, thread.id);
    const before = await prisma.conversation.findUniqueOrThrow({ where: { id: thread.id } });
    const message = await prisma.whatsappMessage.create({ data: { organizationId: orgId, conversationId: thread.id, connectionId: before.connectionId, providerId: randomUUID(), direction: "inbound", type: "text", text: "Mensagem preservada", sentAt: new Date() } });
    await expect(removeUazapiInstancePreservingHistory(otherOrgId, instanceId)).rejects.toMatchObject({ statusCode: 404 });
    await removeUazapiInstancePreservingHistory(orgId, instanceId);
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: thread.id } });
    expect(after).toMatchObject({ instanceId: null, connectionId: before.connectionId, messagingContactId: before.messagingContactId });
    expect((await prisma.channelConnection.findUniqueOrThrow({ where: { id: before.connectionId! } })).status).toBe("disabled");
    expect((await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } })).text).toBe(message.text);
    expect(await prisma.uazapiInstance.findUnique({ where: { id: instanceId } })).toBeNull();
  });
});
