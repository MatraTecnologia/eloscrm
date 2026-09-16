import {
  AuditAction,
  AuditEntity,
  AuditSource,
  BroadcastRecipientStatus,
  BroadcastStatus,
  UazapiInstanceStatus,
} from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import { phoneKey, toWaNumber } from "../../lib/phone.js";
import { createWorker, enqueue } from "../../lib/queue.js";
import * as conversationsRepo from "../whatsapp/conversations.repo.js";
import { sendText } from "../whatsapp/conversations.service.js";
import * as whatsappRepo from "../whatsapp/whatsapp.repo.js";
import * as repo from "./broadcasts.repo.js";
import type {
  CreateBroadcastInput,
  ListBroadcastsQuery,
  PreviewBroadcastInput,
} from "./broadcasts.schema.js";
import { renderTemplate, templateVarsOf } from "./template.js";

export const BROADCAST_QUEUE = "broadcast-send";

// Intervalo entre mensagens: base fixa mais um sorteio. Rajada com ritmo de máquina é o padrão que
// o WhatsApp bloqueia, e o bloqueio derruba o número da imobiliária inteira — não só o disparo.
const GAP_BASE_MS = 6_000;
const GAP_JITTER_MS = 6_000;

const requireConnectedInstance = async (orgId: string) => {
  const instance = await whatsappRepo.findByOrg(orgId);
  if (!instance) throw notFound("Nenhum WhatsApp conectado nesta imobiliária");
  if (instance.status !== UazapiInstanceStatus.connected) {
    throw conflict("INSTANCE_NOT_CONNECTED", "Conecte o WhatsApp antes de fazer um disparo");
  }
  return instance;
};

const requirePipeline = async (orgId: string, pipelineId: string) => {
  const pipeline = await repo.findPipeline(orgId, pipelineId);
  if (!pipeline) throw notFound("Funil não encontrado");
  return pipeline;
};

/** Negócios que o filtro devolve, já com nome do corretor e o número discável (ou null). */
const resolveTargets = async (orgId: string, pipelineId: string, filters: PreviewBroadcastInput["filters"]) => {
  const deals = await repo.matchDeals(orgId, pipelineId, filters);
  const ownerIds = [...new Set(deals.flatMap((d) => (d.ownerId ? [d.ownerId] : [])))];
  const owners = await repo.memberNames(orgId, ownerIds);
  return deals.map((deal) => ({
    deal,
    ownerName: deal.ownerId ? (owners.get(deal.ownerId) ?? null) : null,
    number: toWaNumber(deal.client.phone),
  }));
};

export const preview = async (orgId: string, input: PreviewBroadcastInput) => {
  await requirePipeline(orgId, input.pipelineId);
  const targets = await resolveTargets(orgId, input.pipelineId, input.filters);
  return targets.map(({ deal, ownerName, number }) => ({
    dealId: deal.id,
    title: deal.title,
    value: deal.value,
    stageId: deal.stageId,
    propertyTitle: deal.property?.title ?? null,
    ownerName,
    tags: deal.tags,
    client: { id: deal.client.id, name: deal.client.name, phone: deal.client.phone, temperature: deal.client.temperature },
    // sem número discável a linha aparece, mas desabilitada: a pessoa vê quem ficou de fora e por quê
    sendable: number !== null,
  }));
};

export const create = async (orgId: string, input: CreateBroadcastInput, actor: Actor) => {
  await requireConnectedInstance(orgId);
  const pipeline = await requirePipeline(orgId, input.pipelineId);

  // o filtro roda de novo aqui, e só quem ele devolve pode entrar: um id marcado na tela que não
  // passa mais na condição (o negócio mudou de estágio nesse meio-tempo) fica de fora em silêncio
  const targets = await resolveTargets(orgId, input.pipelineId, input.filters);
  const escolhidos = new Set(input.dealIds);
  const alvos = targets.filter(({ deal }) => escolhidos.has(deal.id));
  if (alvos.length === 0) throw httpError(422, "NO_RECIPIENTS", "Nenhum destinatário selecionado");

  const recipients = alvos.map(({ deal, ownerName, number }) => ({
    dealId: deal.id,
    clientId: deal.client.id,
    clientName: deal.client.name,
    number,
    text: renderTemplate(input.text, templateVarsOf({ ...deal, ownerName })),
    ...(number
      ? {}
      : { status: BroadcastRecipientStatus.SKIPPED, error: "Lead sem telefone válido" }),
  }));
  const skipped = recipients.filter((r) => !r.number).length;

  const broadcast = await repo.createBroadcast(
    {
      organizationId: orgId,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      text: input.text,
      filters: input.filters,
      createdById: actor.id || null,
      createdByName: actor.name,
      total: recipients.length,
      skipped,
      ...(skipped === recipients.length
        ? { status: BroadcastStatus.DONE, finishedAt: new Date() }
        : {}),
    },
    recipients,
  );

  await recordAudit({
    orgId,
    entityType: AuditEntity.BROADCAST,
    entityId: broadcast.id,
    entityLabel: `${pipeline.name} · ${broadcast.total} destinatários`,
    action: AuditAction.CREATED,
    actor,
    context: { pipelineName: pipeline.name },
    snapshot: { total: broadcast.total, skipped, filters: input.filters },
  });

  // um job por destinatário, cada um com o seu atraso acumulado: falha num número não segura os
  // outros, e o espaçamento sobrevive a reinício do worker porque mora no próprio job
  let delay = 0;
  for (const recipient of broadcast.recipients) {
    if (recipient.status !== BroadcastRecipientStatus.PENDING) continue;
    await enqueue(BROADCAST_QUEUE, { recipientId: recipient.id }, { delay, attempts: 1 });
    delay += GAP_BASE_MS + Math.floor(Math.random() * GAP_JITTER_MS);
  }

  return broadcast;
};

export const list = (orgId: string, query: ListBroadcastsQuery) =>
  repo.listBroadcasts(orgId, query.pipelineId);

export const getById = async (orgId: string, id: string) => {
  const broadcast = await repo.findBroadcast(orgId, id);
  if (!broadcast) throw notFound("Disparo não encontrado");
  return broadcast;
};

export const cancel = async (orgId: string, id: string, actor: Actor) => {
  const broadcast = await getById(orgId, id);
  if (broadcast.status !== BroadcastStatus.RUNNING) {
    throw conflict("BROADCAST_NOT_RUNNING", "Este disparo já terminou");
  }
  const updated = await repo.cancelBroadcast(id);
  await recordAudit({
    orgId,
    entityType: AuditEntity.BROADCAST,
    entityId: id,
    entityLabel: `${broadcast.pipelineName} · ${broadcast.total} destinatários`,
    action: AuditAction.CANCELED,
    actor,
    snapshot: { sent: updated.sent, skipped: updated.skipped },
  });
  return updated;
};

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Falha ao enviar";

/**
 * Envia para um destinatário. Nunca lança: o resultado, bom ou ruim, vai para a linha do
 * destinatário — com `attempts: 1` um erro aqui não seria retentado de qualquer jeito, e lançar só
 * deixaria o job "falho" no Redis sem nada na tela.
 */
export const processRecipient = async ({ recipientId }: { recipientId: string }) => {
  const recipient = await repo.findRecipient(recipientId);
  if (!recipient || recipient.status !== BroadcastRecipientStatus.PENDING) return;
  const { broadcast } = recipient;
  const settle = (outcome: Parameters<typeof repo.settleRecipient>[2]) =>
    repo.settleRecipient(recipient.id, broadcast.id, outcome);

  if (broadcast.status !== BroadcastStatus.RUNNING) {
    return settle({ status: "SKIPPED", error: "Disparo cancelado" });
  }
  const instance = await whatsappRepo.findByOrg(broadcast.organizationId);
  if (!instance || instance.status !== UazapiInstanceStatus.connected) {
    return settle({ status: "FAILED", error: "WhatsApp desconectado" });
  }
  const number = recipient.number!;

  try {
    // a conversa é a mesma que a caixa de entrada usa: procurada pela chave do telefone (o nono
    // dígito varia entre o cadastro e o JID) e criada só quando o lead nunca falou com o número
    const key = phoneKey(number);
    const existing = key
      ? await repo.findConversationByPhoneKey(broadcast.organizationId, instance.id, key)
      : null;
    const conversation =
      existing ??
      (await conversationsRepo.upsertConversation(broadcast.organizationId, instance.id, {
        chatid: `${number}@s.whatsapp.net`,
        phone: number,
        phoneKey: key,
        lid: null,
        isGroup: false,
        waName: null,
        contactName: recipient.clientName,
        photoUrl: null,
        suggestedName: recipient.clientName,
      }));

    // o autor é quem criou o disparo, com origem AUTOMATION: a bolha aparece como enviada por ele
    // e o histórico da conversa diz que foi um disparo, não uma mensagem digitada
    const actor: Actor = {
      id: broadcast.createdById ?? "",
      name: broadcast.createdByName,
      source: AuditSource.AUTOMATION,
    };
    const message = await sendText(
      broadcast.organizationId,
      conversation.id,
      { text: recipient.text },
      actor,
    );
    await settle({ status: "SENT", messageId: message.id });
  } catch (err) {
    await settle({ status: "FAILED", error: errorMessage(err) });
  }
};

createWorker<{ recipientId: string }>(
  BROADCAST_QUEUE,
  async (job) => {
    await processRecipient(job.data);
  },
  // um de cada vez: a concorrência anularia o espaçamento entre mensagens
  1,
);
