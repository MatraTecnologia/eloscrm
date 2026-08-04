import { timingSafeEqual } from "node:crypto";
import {
  UazapiInstanceLogEvent as LogEvent,
  UazapiInstanceLogSource as LogSource,
  type UazapiInstance,
} from "../../generated/prisma/client.js";
import { hashToken } from "../../lib/crypto.js";
import { httpError } from "../../lib/http-error.js";
import { applyInstanceSnapshot, eventForTransition, parseStatus, str } from "../../lib/uazapi/snapshot.js";
import { enqueueMessageEvent } from "./ingest.service.js";
import { applyStatusUpdate, parseStatusUpdate } from "./status.service.js";
import * as repo from "./whatsapp.repo.js";
import { connectionDataOf, eventNameOf, type WebhookBody } from "./whatsapp.schema.js";

const HANDLED_EVENTS = new Set(["connection", "messages", "messages_update"]);

const constantTimeEquals = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual exige tamanhos iguais; o length em si não é segredo
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

// Sempre 401, nunca 404: distinguir "instância não existe" de "segredo errado" entregaria a quem
// sondasse a rota um oráculo para enumerar ids de instância.
const unauthorized = () => httpError(401, "UNAUTHORIZED", "Webhook não autorizado");

/**
 * O segredo de 32 bytes na URL é a autenticação. O hash do token é defesa em profundidade e só é
 * conferido **quando o corpo traz o campo**: exigi-lo transformaria um reforço opcional em ponto
 * único de falha, já que não há spec do envelope (ver `webhookBodySchema`) — se a uazapi não
 * mandar `token` no webhook por instância, todo evento seria rejeitado em silêncio.
 */
export const authenticate = async (instanceId: string, secret: string, bodyToken?: string) => {
  const instance = await repo.findById(instanceId);
  if (!instance) throw unauthorized();
  if (!constantTimeEquals(secret, instance.webhookSecret)) throw unauthorized();
  if (bodyToken && !constantTimeEquals(hashToken(bodyToken), instance.tokenHash)) throw unauthorized();
  return instance;
};

const handleConnection = async (instance: UazapiInstance, data: Record<string, unknown>, receivedAt: Date) => {
  const updateData = applyInstanceSnapshot(data, receivedAt);
  const nextStatus = parseStatus(data.status);
  const previousStatus = instance.status;

  // A uazapi não avisa "instância apagada" por evento próprio: vem como desconexão com este motivo.
  const reason = str(data.lastDisconnectReason)?.toLowerCase() ?? "";
  const isDeletion = reason.includes("instance deletion");

  if (isDeletion && !instance.remoteDeletedAt) updateData.remoteDeletedAt = receivedAt;

  await repo.updateAndLog(instance.id, updateData, {
    instanceId: instance.id,
    event: isDeletion
      ? LogEvent.remote_deleted
      : nextStatus
        ? eventForTransition(previousStatus, nextStatus)
        : LogEvent.status_changed,
    source: LogSource.webhook,
    previousStatus,
    newStatus: nextStatus ?? previousStatus,
    message: isDeletion
      ? "instância removida no servidor de WhatsApp"
      : `connection: ${str(data.status) ?? "desconhecido"}`,
    payload: data,
  });
};

export type ProcessResult = { event: string | null; handled: boolean };

export const process = async (
  instance: UazapiInstance,
  body: WebhookBody,
  receivedAt: Date,
): Promise<ProcessResult> => {
  const event = eventNameOf(body);
  // Evento fora da lista responde 200 mesmo assim: devolver erro só faria a uazapi acumular
  // retentativa em /webhook/errors por um evento que nós deliberadamente ignoramos. `event: null`
  // significa envelope irreconhecível — a rota loga, para o sintoma aparecer no nosso log.
  if (!event || !HANDLED_EVENTS.has(event)) return { event, handled: false };

  if (event === "messages_update") {
    // barato: é um updateMany por lote de ids, sem chamada externa. Não precisa de fila.
    const parsed = parseStatusUpdate(body as Record<string, unknown>);
    if (parsed) await applyStatusUpdate(instance.organizationId, parsed);
    return { event, handled: true };
  }

  if (event === "messages") {
    // só enfileira: persistir e baixar mídia aqui dentro faria a uazapi esperar e acumular
    // retentativa. Sem REDIS_URL o enqueue processa inline, que é o modo de teste e CI.
    await enqueueMessageEvent({
      instanceId: instance.id,
      organizationId: instance.organizationId,
      body: body as Record<string, unknown>,
    });
    return { event, handled: true };
  }

  await handleConnection(instance, connectionDataOf(body), receivedAt);
  return { event, handled: true };
};
