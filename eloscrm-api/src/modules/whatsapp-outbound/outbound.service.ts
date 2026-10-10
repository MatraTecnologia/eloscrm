import { Prisma } from "../../generated/prisma/client.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import type { Actor } from "../../lib/actor.js";
import { getOfficialCredentials } from "../channel-connections/channel-connections.service.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import * as graph from "../../lib/whatsapp-official/graph.js";
import * as repo from "./outbound.repo.js";
import { sendSchema, templateSchema, sendResponseSchema, type SendInput, type TemplateDefinition } from "./outbound.schema.js";
import { buildTemplate } from "./template.js";
import { mediaTypes, readMedia, type MediaMime } from "./media.service.js";
import { checkCampaign } from "../whatsapp-campaigns/gate.service.js";

// Motivos de revisão não alteram o conteúdo; POSITIONAL é o formato padrão da Meta.
const templateHash = (definition: TemplateDefinition) => eventHash({ ...definition, parameter_format: definition.parameter_format ?? "POSITIONAL", rejected_reason: undefined });

const prepare = async (orgId: string, connectionId: string, input: SendInput, userId: string, campaignRecipientId?: string | null) => {
  const credentials = await getOfficialCredentials(orgId, connectionId);
  const channel = await repo.connection(orgId, connectionId);
  if (!channel || !await repo.membership(orgId, userId)) throw notFound("Conexão ou usuário indisponível nesta imobiliária");
  const identity = await repo.identity(orgId, input.identityId);
  if (!identity || (identity.source !== "provider" && !(campaignRecipientId && input.type === "template" && identity.source === "campaign_import" && identity.kind === "phone")) || identity.scope !== `business:${channel.businessPortfolioId}` || identity.validUntil || identity.validFrom > new Date() || !["wa_id", "phone", "bsuid", "parent_bsuid"].includes(identity.kind)) throw httpError(422, "OFFICIAL_RECIPIENT_INVALID", "O destinatário exige uma identidade oficial válida nesta conexão");
  const thread = await repo.conversation(orgId, connectionId, identity.contactId);
  if (input.type !== "template" && (!thread?.serviceWindowExpiresAt || thread.serviceWindowExpiresAt <= new Date())) throw httpError(422, "OFFICIAL_WINDOW_CLOSED", "A janela de 24h expirou; selecione um template aprovado");
  let context: { message_id: string } | undefined;
  if (input.quotedMessageId) {
    const quoted = await repo.quoted(orgId, input.quotedMessageId);
    if (!quoted || !thread || quoted.conversationId !== thread.id || quoted.connectionId !== connectionId || !quoted.providerMessageId || quoted.deletedAt || quoted.status === "failed") throw httpError(422, "OFFICIAL_QUOTE_INVALID", "A resposta deve citar uma mensagem do mesmo contato e número oficial");
    context = { message_id: quoted.providerMessageId };
  }
  const payload: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", ...(["bsuid", "parent_bsuid"].includes(identity.kind) ? { recipient: identity.value } : { to: identity.value }), ...(context ? { context } : {}) };
  let text: string | null = null;
  let type: "text" | "image" | "audio" | "video" | "document" = "text";
  let upload: Awaited<ReturnType<typeof repo.upload>> = null;
  if (input.type === "text") { payload.type = "text"; payload.text = { body: input.text, preview_url: false }; text = input.text; }
  if (input.type === "template") {
    const stored = await repo.template(orgId, channel.wabaId!, input.templateId);
    if (!stored) throw notFound("Template não encontrado nesta WABA");
    const definition = templateSchema.parse(stored.definition);
    if (input.headerUploadId) {
      upload = await repo.upload(orgId, connectionId, input.headerUploadId);
      const format = definition.components.find(component => component.type === "HEADER")?.format?.toLowerCase();
      if (!upload || !(upload.mime in mediaTypes) || mediaTypes[upload.mime as MediaMime] !== format) throw httpError(422, "OFFICIAL_TEMPLATE_MEDIA", "O arquivo não corresponde ao cabeçalho deste template ou a esta conexão");
      type = mediaTypes[upload.mime as MediaMime];
    }
    const built = buildTemplate({ ...definition, status: stored.status }, input);
    payload.type = "template"; payload.template = built.payload; text = built.preview;
    payload.templateSnapshot = definition;
  }
  if (input.type === "media") {
    upload = await repo.upload(orgId, connectionId, input.uploadId);
    if (!upload || !(upload.mime in mediaTypes)) throw notFound("Upload não encontrado nesta conexão");
    type = mediaTypes[upload.mime as MediaMime];
    if (type === "audio" && input.caption) throw httpError(422, "OFFICIAL_AUDIO_CAPTION", "Áudio não aceita legenda");
    payload.type = type; payload[type] = { ...(input.caption ? { caption: input.caption } : {}), ...(type === "document" ? { filename: upload.filename } : {}) };
    text = input.caption ?? null;
  }
  return { channel, credentials, payload, text, type, contactId: identity.contactId, upload };
};

export const getCommand = async (orgId: string, id: string) => {
  const command = await repo.publicCommand(orgId, id);
  if (!command) throw notFound("Envio não encontrado nesta imobiliária");
  return command;
};
export const createSend = async (orgId: string, connectionId: string, raw: unknown, actor: Actor, campaignRecipientId?: string) => {
  const input = sendSchema.parse(raw);
  const requestHash = eventHash({ connectionId, input, ...(campaignRecipientId ? { campaignRecipientId } : {}) });
  const previous = await repo.existingCommand(orgId, input.idempotencyKey);
  if (previous) {
    if (previous.requestHash !== requestHash) throw conflict("OFFICIAL_IDEMPOTENCY_CONFLICT", "Esta chave já foi usada com outro envio");
    return getCommand(orgId, previous.id);
  }
  if (campaignRecipientId) await checkCampaign(orgId, campaignRecipientId);
  const prepared = await prepare(orgId, connectionId, input, actor.id, campaignRecipientId);
  try {
    const id = await repo.createCommand(prepared.channel, input, requestHash, prepared.payload as Prisma.InputJsonObject, prepared.text, prepared.type, actor, prepared.contactId, prepared.upload ?? undefined, campaignRecipientId);
    return getCommand(orgId, id);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const saved = await repo.existingCommand(orgId, input.idempotencyKey);
      if (saved?.requestHash === requestHash) return getCommand(orgId, saved.id);
      if (saved) throw conflict("OFFICIAL_IDEMPOTENCY_CONFLICT", "Esta chave já foi usada com outro envio");
    }
    throw error;
  }
};

export const syncTemplates = async (orgId: string, connectionId: string) => {
  const startedAt = new Date();
  const credentials = await getOfficialCredentials(orgId, connectionId);
  const definitions = (await graph.readTemplates(credentials.accessToken, credentials.wabaId!)).map(value => templateSchema.parse(value));
  await repo.saveTemplates(orgId, credentials.wabaId!, definitions, startedAt);
  return repo.listTemplates(orgId, credentials.wabaId!);
};
export const listTemplates = async (orgId: string, connectionId: string) => {
  const channel = await repo.connection(orgId, connectionId);
  if (!channel) throw notFound("Conexão não encontrada");
  return repo.listTemplates(orgId, channel.wabaId!);
};

export const executeSend = async (orgId: string, id: string) => {
  const leaseToken = await repo.claim(orgId, id);
  if (!leaseToken) return;
  let submitted = false;
  try {
    const command = await repo.command(orgId, id);
    if (!command) return;
    if (command.campaignRecipientId) await checkCampaign(orgId, command.campaignRecipientId);
    const input = sendSchema.parse(command.request);
    const prepared = await prepare(orgId, command.connectionId, input, command.actorUserId, command.campaignRecipientId);
    if (eventHash(prepared.payload) !== eventHash(command.payload)) throw httpError(422, "OFFICIAL_SEND_CHANGED", "O destinatário ou template mudou; prepare um novo envio");
    if (input.type === "template") {
      const snapshot = templateSchema.parse(prepared.payload.templateSnapshot);
      const definitions = (await graph.readTemplates(prepared.credentials.accessToken, prepared.credentials.wabaId!, snapshot.name)).map(value => templateSchema.parse(value));
      const current = definitions.find(definition => definition.id === snapshot.id && definition.language === snapshot.language);
      if (!current || current.status !== "APPROVED" || templateHash(current) !== templateHash(snapshot)) throw httpError(422, "OFFICIAL_TEMPLATE_CHANGED", "O template mudou ou perdeu a aprovação; sincronize e prepare um novo envio");
    }
    const payload = { ...prepared.payload };
    delete payload.templateSnapshot;
    if (prepared.upload) {
      const buffer = await readMedia(prepared.upload);
      const mediaId = await graph.uploadMedia(prepared.credentials.accessToken, prepared.credentials.phoneNumberId!, buffer, prepared.upload.mime, prepared.upload.filename);
      if (input.type === "template") {
        const template = payload.template as { components: { type: string; parameters?: Record<string, unknown>[] }[] };
        const header = template.components.find(component => component.type === "header");
        if (!header) throw httpError(422, "OFFICIAL_TEMPLATE_MEDIA", "Cabeçalho de mídia ausente");
        header.parameters = [{ type: prepared.type, [prepared.type]: { id: mediaId, ...(prepared.type === "document" ? { filename: prepared.upload.filename } : {}) } }];
      } else payload[prepared.type] = { ...(payload[prepared.type] as Record<string, unknown>), id: mediaId };
    }
    // Upload/consulta podem levar tempo: a janela e o estado local são verificados no instante da submissão.
    const finalCheck = await prepare(orgId, command.connectionId, input, command.actorUserId, command.campaignRecipientId);
    if (command.campaignRecipientId) await checkCampaign(orgId, command.campaignRecipientId);
    if (eventHash(finalCheck.payload) !== eventHash(command.payload)) throw httpError(422, "OFFICIAL_SEND_CHANGED", "O envio mudou antes da submissão");
    if (!await repo.markSending(orgId, id, leaseToken)) return;
    submitted = true;
    const response = sendResponseSchema.parse(await graph.sendMessage(finalCheck.credentials.accessToken, finalCheck.credentials.phoneNumberId!, payload));
    await repo.recordResponse(orgId, id, leaseToken, response.messages[0]!.id);
    await repo.accept(finalCheck.channel, id, leaseToken, response.messages[0]!.id);
  } catch (error) {
    const providerError = error instanceof graph.OfficialGraphError ? error : null;
    const uncertain = submitted && (!providerError || providerError.uncertain);
    const safeError = uncertain ? "A resposta da Meta não foi confirmada; não reenviar automaticamente" : error instanceof Error && "expose" in error && error.expose === true ? error.message : "Não foi possível enviar pela conexão oficial";
    await repo.finishFailure(orgId, id, leaseToken, uncertain, safeError, providerError?.code ?? null);
  }
};

export const recoverSends = async () => {
  const pending = await repo.recover();
  for (const command of await repo.knownResponses()) {
    const leaseToken = await repo.claimReconciliation(command.organizationId, command.id);
    if (!leaseToken) continue;
    const channel = await repo.connection(command.organizationId, command.connectionId);
    if (channel) await repo.accept(channel, command.id, leaseToken, command.externalMessageId!).catch(() => {});
  }
  // Limita memória durante uploads e usa o banco como fonte de trabalho, inclusive sem Redis.
  for (const command of pending) await executeSend(command.organizationId, command.id);
};
export const scheduleSendRecovery = () => {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await recoverSends(); } catch { /* O próximo ciclo recupera comandos pendentes sem expor conteúdo privado. */ } finally { running = false; } };
  const timer = setInterval(() => { void tick(); }, 5000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
};
