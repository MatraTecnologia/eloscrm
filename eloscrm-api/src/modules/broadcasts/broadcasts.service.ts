import {
  AuditAction,
  AuditEntity,
  AuditSource,
  BroadcastRecipientStatus,
  BroadcastStatus,
  UazapiInstanceStatus,
  Prisma,
} from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { recordAudit } from "../../lib/audit.js";
import { conflict, httpError, notFound } from "../../lib/http-error.js";
import { phoneKey, toWaNumber } from "../../lib/phone.js";
import { createWorker, enqueue, queueEnabled } from "../../lib/queue.js";
import { env } from "../../env.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import * as conversationsRepo from "../whatsapp/conversations.repo.js";
import { sendText } from "../whatsapp/conversations.service.js";
import * as whatsappRepo from "../whatsapp/whatsapp.repo.js";
import * as repo from "./broadcasts.repo.js";
import type {
  CreateBroadcastInput,
  ListBroadcastsQuery,
  PreviewBroadcastInput,
} from "./broadcasts.schema.js";
import { applyReplyFilter } from "./reply-filter.js";
import { renderTemplate, templateVarsOf } from "./template.js";
import { importBroadcastRecipients } from "../campaign-imports/broadcast-audience.service.js";
import { importedAudienceSchema } from "../campaign-imports/imports.schema.js";

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
  const deals = await applyReplyFilter(orgId, await repo.matchDeals(orgId, pipelineId, filters), filters);
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
  return targets.map(({ deal, ownerName, number }) => {
    const exclusion = !number ? "Lead sem telefone válido" : null;
    return {
      dealId: deal.id,
      title: deal.title,
      value: deal.value,
      stageId: deal.stageId,
      propertyTitle: deal.property?.title ?? null,
      ownerName,
      tags: deal.tags,
      client: { id: deal.client.id, name: deal.client.name, phone: deal.client.phone, temperature: deal.client.temperature },
      // A exclusão permanece visível para o gestor conferir a causa antes de disparar.
      sendable: exclusion === null,
      exclusion,
    };
  });
};

export const create = async (orgId: string, input: CreateBroadcastInput, actor: Actor) => {
  const requestHash = eventHash({ ...input, idempotencyKey: undefined });
  if (input.idempotencyKey) {
    const previous = await repo.existing(orgId, input.idempotencyKey);
    if (previous) {
      if (previous.requestHash !== requestHash) throw conflict("BROADCAST_IDEMPOTENCY", "Esta solicitação já foi usada com outro disparo");
      return previous;
    }
  }
  await requireConnectedInstance(orgId);
  if (env.NODE_ENV !== "test" && !queueEnabled()) throw httpError(503, "BROADCAST_REDIS_REQUIRED", "Configure Redis para executar disparos em segundo plano");
  const pipeline = await requirePipeline(orgId, input.pipelineId);

  // o filtro roda de novo aqui, e só quem ele devolve pode entrar: um id marcado na tela que não
  // passa mais na condição (o negócio mudou de estágio nesse meio-tempo) fica de fora em silêncio
  const targets = input.importedAudience ? [] : await resolveTargets(orgId, input.pipelineId, input.filters);
  const selectedDeals = new Set(input.dealIds);
  const selectedTargets = targets.filter(({ deal }) => selectedDeals.has(deal.id));
  if (selectedTargets.length === 0 && !input.importedAudience) throw httpError(422, "NO_RECIPIENTS", "Nenhum destinatário selecionado");

  const seen = new Set<string>();
  const recipients = input.importedAudience ? importBroadcastRecipients(input.importedAudience, input.text) : selectedTargets.map(({ deal, ownerName, number }) => {
    const key = phoneKey(number);
    const duplicate = !!key && seen.has(key);
    if (key) seen.add(key);
    const text = renderTemplate(input.text, templateVarsOf({ ...deal, ownerName }));
    if (text.length > 2000 || /\{\{|\}\}/.test(text)) throw httpError(422, "BROADCAST_MESSAGE_INVALID", "A mensagem personalizada contém variável desconhecida ou excede 2000 caracteres");
    return {
    dealId: deal.id,
    clientId: deal.client.id,
    clientName: deal.client.name,
    number,
    text,
    ...(duplicate ? { status: BroadcastRecipientStatus.SKIPPED, error: "Telefone repetido neste disparo", errorCode: "DUPLICATE_DESTINATION", errorStage: "selection" } : number
      ? { status: BroadcastRecipientStatus.PENDING }
      : { status: BroadcastRecipientStatus.SKIPPED, error: "Lead sem telefone válido", errorCode: "INVALID_DESTINATION", errorStage: "selection" }),
  }; });
  const skipped = recipients.filter((r) => r.status === BroadcastRecipientStatus.SKIPPED).length;

  let broadcast;
  try { broadcast = await repo.createBroadcast(
    {
      organizationId: orgId,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      text: input.text,
      filters: input.importedAudience ? { ...input.filters, importedAudience: input.importedAudience } : input.filters,
      createdById: actor.id || null,
      createdByName: actor.name,
      total: recipients.length,
      skipped,
      id: input.idempotencyKey,
      requestHash,
      ...(skipped === recipients.length
        ? { status: BroadcastStatus.DONE, finishedAt: new Date() }
        : {}),
    },
    recipients,
  ); } catch (error) {
    if (input.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previous = await repo.existing(orgId, input.idempotencyKey);
      if (previous?.requestHash === requestHash) return previous;
    }
    throw error;
  }

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
  if (broadcast.status !== BroadcastStatus.RUNNING && broadcast.status !== BroadcastStatus.PAUSED) {
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

export const changeState = async (orgId: string, id: string, status: "RUNNING" | "PAUSED", actor: Actor) => {
  if (status === "RUNNING") { await requireConnectedInstance(orgId); if (env.NODE_ENV !== "test" && !queueEnabled()) throw httpError(503, "BROADCAST_REDIS_REQUIRED", "Configure Redis para retomar os disparos"); }
  return repo.transition(orgId, id, status, actor);
};

/**
 * Envia para um destinatário. Nunca lança: o resultado, bom ou ruim, vai para a linha do
 * destinatário — com `attempts: 1` um erro aqui não seria retentado de qualquer jeito, e lançar só
 * deixaria o job "falho" no Redis sem nada na tela.
 */
export const processRecipient = async ({ recipientId }: { recipientId: string }) => {
  const recipient = await repo.claimRecipient(recipientId, queueEnabled());
  if (!recipient) return;
  const { broadcast } = recipient;
  const settle = (outcome: Parameters<typeof repo.settleRecipient>[2]) =>
    repo.settleRecipient(recipient.id, broadcast.id, outcome);

  let submitting = false;
  try {
  const imported = typeof broadcast.filters === "object" && broadcast.filters && "importedAudience" in broadcast.filters ? importedAudienceSchema.parse(broadcast.filters.importedAudience) : null;
  if (imported && !imported.recipients.some(value => value.phone === recipient.number && `import:${value.phone}` === recipient.dealId)) return settle({ status: "SKIPPED", error: "Destinatário não pertence à lista importada", errorCode: "INVALID_DESTINATION", errorStage: "validation" });
  const instance = await whatsappRepo.findByOrg(broadcast.organizationId);
  if (!instance || instance.status !== UazapiInstanceStatus.connected) {
    return settle({ status: "FAILED", error: "WhatsApp desconectado", errorCode: "INSTANCE_NOT_CONNECTED", errorStage: "connection" });
  }
  const number = recipient.number!;

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
    const current = await repo.findBroadcast(broadcast.organizationId, broadcast.id);
    if (current?.status === "PAUSED") return repo.releaseRecipient(recipient.id);
    if (current?.status !== "RUNNING") return settle({ status: "SKIPPED", error: "Disparo encerrado", errorCode: "BROADCAST_STOPPED", errorStage: "validation" });
    submitting = true;
    const message = await sendText(
      broadcast.organizationId,
      conversation.id,
      { text: recipient.text },
      actor,
    );
    await settle({ status: "SENT", messageId: message.id });
  } catch (err) {
    const code = err instanceof Error && "code" in err && typeof err.code === "string" && /^[A-Z0-9_]{1,80}$/.test(err.code) ? err.code : "SEND_ERROR";
    const ambiguous = submitting && !["WHATSAPP_BLOCKED", "UAZAPI_ERROR", "INSTANCE_NOT_CONNECTED"].includes(code);
    await settle({ status: ambiguous ? "UNKNOWN" : "FAILED", error: ambiguous ? "O provedor pode ter recebido a mensagem. Resultado incerto; confira o destino antes de repetir." : code === "WHATSAPP_BLOCKED" ? "O WhatsApp recusou o envio por restrição da plataforma" : "Não foi possível enviar para este destinatário", errorCode: code, errorStage: submitting ? "provider" : "preparation" });
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

export const recoverBroadcasts = async () => {
  if (!queueEnabled()) return;
  for (const row of await repo.recoverable()) {
    if (row.status === "PROCESSING") await repo.settleRecipient(row.id, row.broadcastId, { status: "UNKNOWN", error: "A execução foi interrompida sem confirmação. O envio não será repetido automaticamente.", errorCode: "WORKER_INTERRUPTED", errorStage: "recovery" });
    else await enqueue(BROADCAST_QUEUE, { recipientId: row.id }, { attempts: 1, jobId: `broadcast-${row.id}-${Math.floor(Date.now() / 10000)}` });
  }
};

export const scheduleBroadcastRecovery = () => {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await recoverBroadcasts(); } catch { /* A intenção permanece no banco para o próximo ciclo. */ } finally { running = false; } };
  const timer = setInterval(() => { void tick(); }, 10000);
  timer.unref(); void tick();
  return () => clearInterval(timer);
};
