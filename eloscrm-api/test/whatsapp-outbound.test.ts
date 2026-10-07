import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../src/lib/whatsapp-official/graph.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/lib/whatsapp-official/graph.js")>(), sendMessage: vi.fn(), readTemplates: vi.fn(), uploadMedia: vi.fn() }));
vi.mock("../src/modules/whatsapp-outbound/media.service.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/modules/whatsapp-outbound/media.service.js")>(), readMedia: vi.fn() }));
import * as graph from "../src/lib/whatsapp-official/graph.js";
import * as media from "../src/modules/whatsapp-outbound/media.service.js";
import * as service from "../src/modules/whatsapp-outbound/outbound.service.js";
import * as repo from "../src/modules/whatsapp-outbound/outbound.repo.js";
import { buildTemplate } from "../src/modules/whatsapp-outbound/template.js";
import { ingestMessage } from "../src/modules/whatsapp-official/ingest.repo.js";
import { ingestReceipt } from "../src/modules/whatsapp-official/receipts.repo.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/env.js";
import { makeApp } from "./helpers/app.js";
import { signUpWithOrg } from "./helpers/session.js";
import { createOfficialConnectionFixture } from "./helpers/official-connection.js";
import type { ChannelConnection } from "../src/generated/prisma/client.js";
import type { TemplateDefinition } from "../src/modules/whatsapp-outbound/outbound.schema.js";

let app: FastifyInstance;
let orgA: string;
let orgB: string;
let cookieA: string;
let cookieB: string;
let userId: string;
let channel: ChannelConnection;
let identityId: string;
let threadId: string;
let templateId: string;
let definition: TemplateDefinition;
let sequence = 0;
const stamp = `${process.pid}-${Date.now()}`;
const actor = () => ({ id: userId, name: "Corretor fictício" });
const textInput = () => ({ idempotencyKey: randomUUID(), identityId, type: "text" as const, text: "Mensagem fictícia" });
const templateInput = () => ({ idempotencyKey: randomUUID(), identityId, type: "template" as const, templateId, parameters: { header: {}, body: { "1": "Cliente fictício" } } });
const headers = () => ({ cookie: cookieA, origin: env.WEB_ORIGIN });
beforeAll(async () => {
  app = await makeApp();
  ({ orgId: orgA, cookie: cookieA } = await signUpWithOrg(app, `outbound-a-${stamp}@eloscrm.test`, `outbound-a-${stamp}`));
  ({ orgId: orgB, cookie: cookieB } = await signUpWithOrg(app, `outbound-b-${stamp}@eloscrm.test`, `outbound-b-${stamp}`));
  const session = await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie: cookieA } });
  userId = session.json().user.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => {
  vi.resetAllMocks();
  const fixture = await createOfficialConnectionFixture(orgA);
  channel = (await repo.connection(orgA, fixture.connection.id))!;
  threadId = await ingestMessage(channel, { id: `inbound-${sequence++}`, from: "15550001111", type: "text", text: { body: "Consulta fictícia" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "cloud_api", new Date());
  identityId = (await prisma.contactIdentity.findFirstOrThrow({ where: { organizationId: orgA, connectionId: channel.id, kind: "wa_id" } })).id;
  definition = { id: String(sequence++ + 1000), name: "appointment_notice", language: "pt_BR", category: "UTILITY", status: "APPROVED", parameter_format: "POSITIONAL", components: [{ type: "BODY", text: "Olá {{1}}" }] };
  vi.mocked(graph.readTemplates).mockResolvedValue([definition]);
  await service.syncTemplates(orgA, channel.id);
  templateId = (await repo.listTemplates(orgA, channel.wabaId!))[0]!.id;
  vi.mocked(graph.sendMessage).mockImplementation(async () => ({ messages: [{ id: `wamid.test.${sequence++}` }] }));
  vi.mocked(graph.uploadMedia).mockResolvedValue("123456789");
  vi.mocked(media.readMedia).mockResolvedValue(Buffer.from("%PDF-fixture"));
});

describe("envio oficial persistido", () => {
  it("exige sessão, origem exata e payload estrito sem expor conteúdo privado", async () => {
    const url = `/v1/whatsapp/outbound/connections/${channel.id}/messages`;
    expect((await app.inject({ method: "POST", url, payload: textInput() })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { ...headers(), origin: "https://foreign.eloscrm.test" }, payload: textInput() })).statusCode).toBe(403);
    const response = await app.inject({ method: "POST", url, headers: headers(), payload: { ...textInput(), token: "private-fixture" } });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain("private-fixture");
    expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("persiste comando, autoria e mensagem antes de chamar a Meta", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    expect(command.status).toBe("pending");
    expect(graph.sendMessage).not.toHaveBeenCalled();
    vi.mocked(graph.sendMessage).mockImplementationOnce(async () => {
      const saved = await repo.command(orgA, command.id);
      expect(saved?.status).toBe("sending");
      expect(await prisma.whatsappMessage.findFirst({ where: { organizationId: orgA, id: command.messageId } })).toMatchObject({ status: "pending", sentById: userId });
      return { messages: [{ id: "wamid.persisted" }] };
    });
    await service.executeSend(orgA, command.id);
    expect(await service.getCommand(orgA, command.id)).toMatchObject({ status: "accepted", externalMessageId: "wamid.persisted" });
    const thread = await prisma.conversation.findFirstOrThrow({ where: { id: threadId, organizationId: orgA } });
    expect(thread.serviceWindowExpiresAt).toBeTruthy();
    expect(thread.unreadCount).toBe(1);
  });
  it("mesma chave concorrente cria um único comando; payload diferente gera conflito", async () => {
    const input = textInput();
    const [left, right] = await Promise.all([service.createSend(orgA, channel.id, input, actor()), service.createSend(orgA, channel.id, input, actor())]);
    expect(left.id).toBe(right.id);
    await expect(service.createSend(orgA, channel.id, { ...input, text: "Outro conteúdo" }, actor())).rejects.toMatchObject({ statusCode: 409 });
    await Promise.all([service.executeSend(orgA, left.id), service.executeSend(orgA, left.id)]);
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
    expect(await service.createSend(orgA, channel.id, input, actor())).toMatchObject({ id: left.id, status: "accepted" });
  });
  it("isola comandos, conexão, identidade, template e upload entre imobiliárias", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    expect((await app.inject({ method: "GET", url: `/v1/whatsapp/outbound/commands/${command.id}`, headers: { cookie: cookieB } })).statusCode).toBe(404);
    await expect(service.createSend(orgB, channel.id, textInput(), actor())).rejects.toMatchObject({ statusCode: 404 });
    const foreign = await createOfficialConnectionFixture(orgB);
    await expect(service.createSend(orgA, foreign.connection.id, textInput(), actor())).rejects.toMatchObject({ statusCode: 404 });
    expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("revalida janela ao executar e nunca recorre à uazapi", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    await prisma.conversation.update({ where: { id: threadId }, data: { serviceWindowExpiresAt: new Date(Date.now() - 1) } });
    await service.executeSend(orgA, command.id);
    expect(await service.getCommand(orgA, command.id)).toMatchObject({ status: "failed", safeError: expect.stringContaining("24h") });
    expect(graph.sendMessage).not.toHaveBeenCalled();
    await expect(service.createSend(orgA, channel.id, textInput(), actor())).rejects.toMatchObject({ code: "OFFICIAL_WINDOW_CLOSED" });
  });
  it("revalida conexão e vínculo do autor antes de enviar", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    await prisma.channelConnection.update({ where: { id: channel.id }, data: { status: "disabled" } });
    await service.executeSend(orgA, command.id);
    expect((await service.getCommand(orgA, command.id)).status).toBe("failed");
    expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("não envia identidade aposentada ou alterada depois do preview", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    await prisma.contactIdentity.update({ where: { id: identityId }, data: { validUntil: new Date() } });
    await service.executeSend(orgA, command.id);
    expect((await service.getCommand(orgA, command.id)).status).toBe("failed");
    expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("envia por BSUID sem exigir telefone e preserva seu escopo", async () => {
    await prisma.contactIdentity.update({ where: { id: identityId }, data: { kind: "bsuid", value: "BR.ABC.fixture" } });
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    await service.executeSend(orgA, command.id);
    expect(graph.sendMessage).toHaveBeenCalledWith(expect.any(String), channel.phoneNumberId, expect.objectContaining({ recipient: "BR.ABC.fixture" }));
    expect(vi.mocked(graph.sendMessage).mock.calls[0]![2]).not.toHaveProperty("to");
  });
  it("cita somente mensagem do mesmo contato e número oficial", async () => {
    const source = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgA, conversationId: threadId } });
    const command = await service.createSend(orgA, channel.id, { ...textInput(), quotedMessageId: source.id }, actor());
    await service.executeSend(orgA, command.id);
    expect(graph.sendMessage).toHaveBeenCalledWith(expect.any(String), channel.phoneNumberId, expect.objectContaining({ context: { message_id: source.providerMessageId } }));
    const other = await createOfficialConnectionFixture(orgA);
    const otherThread = await ingestMessage((await repo.connection(orgA, other.connection.id))!, { id: "different-inbound", from: "15550001111", type: "text", text: { body: "Outro" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "cloud_api", new Date());
    const unrelated = await prisma.whatsappMessage.findFirstOrThrow({ where: { organizationId: orgA, conversationId: otherThread } });
    await expect(service.createSend(orgA, channel.id, { ...textInput(), quotedMessageId: unrelated.id }, actor())).rejects.toMatchObject({ code: "OFFICIAL_QUOTE_INVALID" });
  });
  it("timeout fica incerto e recuperação não repete a submissão", async () => {
    const input = textInput();
    const command = await service.createSend(orgA, channel.id, input, actor());
    vi.mocked(graph.sendMessage).mockRejectedValueOnce(new graph.OfficialGraphError(null, true));
    await service.executeSend(orgA, command.id);
    await service.recoverSends();
    await service.executeSend(orgA, command.id);
    expect(await service.createSend(orgA, channel.id, input, actor())).toMatchObject({ status: "uncertain", id: command.id });
    expect(vi.mocked(graph.sendMessage).mock.calls.filter(call => call[1] === channel.phoneNumberId)).toHaveLength(1);
    expect((await prisma.whatsappMessage.findFirstOrThrow({ where: { id: command.messageId, organizationId: orgA } })).status).toBe("pending");
  });
  it("erro confirmado da Meta falha sem vazar a resposta", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    vi.mocked(graph.sendMessage).mockRejectedValueOnce(new graph.OfficialGraphError(131047, false));
    await service.executeSend(orgA, command.id);
    expect(await service.getCommand(orgA, command.id)).toMatchObject({ status: "failed", providerErrorCode: 131047 });
  });
  it("resposta inválida depois da submissão fica incerta", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    vi.mocked(graph.sendMessage).mockResolvedValueOnce({ messages: [] });
    await service.executeSend(orgA, command.id);
    expect((await service.getCommand(orgA, command.id)).status).toBe("uncertain");
  });
  it("resposta persistida sobrevive a crash e é conciliada sem novo envio", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    const leaseToken = (await repo.claim(orgA, command.id))!;
    expect(await repo.markSending(orgA, command.id, leaseToken)).toBe(true);
    await repo.recordResponse(orgA, command.id, leaseToken, "wamid.confirmed.before-crash");
    await prisma.officialSendCommand.update({ where: { id: command.id }, data: { leaseExpiresAt: new Date(0) } });
    await service.recoverSends();
    expect(await service.getCommand(orgA, command.id)).toMatchObject({ status: "accepted", externalMessageId: "wamid.confirmed.before-crash" });
    expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("resposta tardia após expirar a lease continua disponível para conciliação", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    vi.mocked(graph.sendMessage).mockImplementationOnce(async () => {
      await prisma.officialSendCommand.update({ where: { id: command.id }, data: { leaseExpiresAt: new Date(0) } });
      await repo.recover();
      return { messages: [{ id: "wamid.late.response" }] };
    });
    await service.executeSend(orgA, command.id);
    expect(await service.getCommand(orgA, command.id)).toMatchObject({ status: "uncertain", externalMessageId: "wamid.late.response" });
    await service.recoverSends();
    expect(await service.getCommand(orgA, command.id)).toMatchObject({ status: "accepted", externalMessageId: "wamid.late.response" });
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("recupera preparação abandonada e mantém submissão abandonada incerta", async () => {
    const first = await service.createSend(orgA, channel.id, textInput(), actor());
    const second = await service.createSend(orgA, channel.id, textInput(), actor());
    await prisma.officialSendCommand.update({ where: { id: first.id }, data: { status: "preparing", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1) } });
    await prisma.officialSendCommand.update({ where: { id: second.id }, data: { status: "sending", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1) } });
    await service.recoverSends();
    expect((await service.getCommand(orgA, first.id)).status).toBe("accepted");
    expect((await service.getCommand(orgA, second.id)).status).toBe("uncertain");
    expect(graph.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("status e eco antes da resposta são conciliados preservando autoria", async () => {
    const command = await service.createSend(orgA, channel.id, textInput(), actor());
    const externalId = `wamid.early.${sequence++}`;
    vi.mocked(graph.sendMessage).mockImplementationOnce(async () => {
      await ingestReceipt(channel, { id: externalId, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), pricing: { billable: true, category: "utility" } }, new Date());
      await ingestMessage(channel, { id: externalId, to: "15550001111", type: "text", text: { body: "Eco" }, timestamp: String(Math.floor(Date.now() / 1000)) }, [], "business_app", new Date());
      return { messages: [{ id: externalId }] };
    });
    await service.executeSend(orgA, command.id);
    const messages = await prisma.whatsappMessage.findMany({ where: { organizationId: orgA, connectionId: channel.id, providerMessageId: externalId } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: command.messageId, sentById: userId, text: "Mensagem fictícia", status: "read", origin: "cloud_api" });
    await ingestReceipt(channel, { id: externalId, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000) + 10) }, new Date());
    expect((await prisma.whatsappMessage.findFirstOrThrow({ where: { id: command.messageId, organizationId: orgA } })).status).toBe("read");
  });
});

describe("templates e mídia oficiais", () => {
  it("template aprovado funciona fora da janela e leva snapshot exato", async () => {
    await prisma.conversation.update({ where: { id: threadId }, data: { serviceWindowExpiresAt: new Date(0) } });
    const command = await service.createSend(orgA, channel.id, templateInput(), actor());
    expect((await repo.command(orgA, command.id))?.payload).toHaveProperty("templateSnapshot", definition);
    await service.executeSend(orgA, command.id);
    expect(graph.sendMessage).toHaveBeenCalledWith(expect.any(String), channel.phoneNumberId, expect.objectContaining({ type: "template", template: expect.objectContaining({ name: "appointment_notice", components: [{ type: "body", parameters: [{ type: "text", text: "Cliente fictício" }] }] }) }));
    expect(vi.mocked(graph.sendMessage).mock.calls[0]![2]).not.toHaveProperty("templateSnapshot");
  });
  it("mudança de aprovação, definição ou variável impede o envio", async () => {
    await expect(service.createSend(orgA, channel.id, { ...templateInput(), parameters: { header: {}, body: { wrong: "valor" } } }, actor())).rejects.toMatchObject({ code: "OFFICIAL_TEMPLATE_PARAMETERS" });
    const command = await service.createSend(orgA, channel.id, templateInput(), actor());
    vi.mocked(graph.readTemplates).mockResolvedValueOnce([{ ...definition, status: "PAUSED" }]);
    await service.executeSend(orgA, command.id);
    expect((await service.getCommand(orgA, command.id)).status).toBe("failed");
    expect(graph.sendMessage).not.toHaveBeenCalled();
  });
  it("variáveis nomeadas são exatas; mídia e botão dinâmico são rejeitados", () => {
    const input = { ...templateInput(), parameters: { header: {}, body: { name: "Cliente" } } };
    expect(buildTemplate({ ...definition, parameter_format: "NAMED", components: [{ type: "BODY", text: "Olá {{name}}" }] }, input).payload.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "Cliente", parameter_name: "name" }] }]);
    expect(() => buildTemplate({ ...definition, components: [{ type: "HEADER", format: "IMAGE" }] }, input)).toThrow();
    expect(() => buildTemplate({ ...definition, components: [{ type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.test/{{1}}" }] }] }, input)).toThrow();
    expect(() => buildTemplate({ ...definition, parameter_format: "NAMED", components: [{ type: "HEADER", format: "TEXT", text: "Olá {{name}}" }] }, { ...input, parameters: { header: { name: "x".repeat(61) }, body: {} } })).toThrow();
    expect(() => buildTemplate(definition, { ...templateInput(), parameters: { header: {}, body: { "1": "x".repeat(1024) } } })).toThrow();
  });
  it("upload validado fica privado e envio usa ID da Meta, sem URL do cliente", async () => {
    const uploadId = randomUUID();
    await repo.saveUpload({ id: uploadId, organizationId: orgA, connectionId: channel.id, key: `org/${orgA}/fixture.pdf`, mime: "application/pdf", size: 12, digest: media.digestOf(Buffer.from("%PDF-fixture")), filename: "fixture.pdf" });
    const command = await service.createSend(orgA, channel.id, { idempotencyKey: randomUUID(), identityId, type: "media", uploadId, caption: "Documento fictício" }, actor());
    await service.executeSend(orgA, command.id);
    expect(graph.uploadMedia).toHaveBeenCalledTimes(1);
    expect(graph.sendMessage).toHaveBeenCalledWith(expect.any(String), channel.phoneNumberId, expect.objectContaining({ type: "document", document: { id: "123456789", filename: "fixture.pdf", caption: "Documento fictício" } }));
  });
  it("a janela é revalidada depois do upload da mídia", async () => {
    const uploadId = randomUUID();
    await repo.saveUpload({ id: uploadId, organizationId: orgA, connectionId: channel.id, key: `org/${orgA}/fixture.pdf`, mime: "application/pdf", size: 12, digest: media.digestOf(Buffer.from("%PDF-fixture")), filename: "fixture.pdf" });
    const command = await service.createSend(orgA, channel.id, { idempotencyKey: randomUUID(), identityId, type: "media", uploadId }, actor());
    vi.mocked(graph.uploadMedia).mockImplementationOnce(async () => { await prisma.conversation.update({ where: { id: threadId }, data: { serviceWindowExpiresAt: new Date(0) } }); return "12345"; });
    await service.executeSend(orgA, command.id);
    expect(graph.sendMessage).not.toHaveBeenCalled();
    expect((await service.getCommand(orgA, command.id)).status).toBe("failed");
  });
  it("valida assinatura binária, tamanho e OGG/Opus em vez de confiar no MIME", () => {
    expect(() => media.validateMedia(Buffer.from("%PDF-fixture"), "application/pdf")).not.toThrow();
    expect(() => media.validateMedia(Buffer.from("<svg>"), "image/png")).toThrow();
    expect(() => media.validateMedia(Buffer.from("OggS-vorbis"), "audio/ogg")).toThrow();
    expect(() => media.validateMedia(Buffer.alloc(5 * 1024 * 1024 + 1), "image/jpeg")).toThrow();
  });
});
