import {
  UazapiInstanceLogEvent as LogEvent,
  UazapiInstanceLogSource as LogSource,
  UazapiInstanceStatus,
  type UazapiInstance,
} from "../../generated/prisma/client.js";
import type { Actor } from "../../lib/actor.js";
import { encryptToken, hashToken, last4, newWebhookSecret } from "../../lib/crypto.js";
import { conflict, forbidden, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import { prisma } from "../../lib/prisma.js";
import type { UazapiClient } from "../../lib/uazapi/index.js";
import { applyInstanceSnapshot, parseStatus, str } from "../../lib/uazapi/snapshot.js";
import type { Result } from "../../lib/uazapi/types.js";
import {
  adminClient,
  instanceClient,
  isInstanceGone,
  maskWebhookUrl,
  requireIntegration,
  tokenClient,
  uazapiError,
  webhookUrl,
  type IntegrationConfig,
} from "./whatsapp.gateway.js";
import * as repo from "./whatsapp.repo.js";
import type { ConnectInstanceInput, CreateInstanceInput, ListLogsQuery, RenameInstanceInput } from "./whatsapp.schema.js";
import { serializeInstance } from "./whatsapp.serialize.js";

const WEBHOOK_EVENTS = ["connection"] as const;

const requireManager = async (orgId: string, actor: Actor) => {
  if (!(await isOrgManager(orgId, actor.id))) {
    throw forbidden("Só o dono ou um gestor da imobiliária pode alterar a integração de WhatsApp");
  }
};

const requireInstance = async (orgId: string) => {
  const instance = await repo.findByOrg(orgId);
  if (!instance) throw notFound("Nenhum WhatsApp conectado nesta imobiliária");
  return instance;
};

const remoteDeletedError = () =>
  conflict(
    "INSTANCE_REMOTE_DELETED",
    "Esta instância não existe mais no servidor de WhatsApp. Remova e conecte novamente.",
  );

const guardRemoteAlive = (instance: UazapiInstance) => {
  if (instance.remoteDeletedAt) throw remoteDeletedError();
};

const markRemoteDeleted = (instance: UazapiInstance, receivedAt: Date) =>
  repo.updateAndLog(
    instance.id,
    {
      remoteDeletedAt: receivedAt,
      status: UazapiInstanceStatus.disconnected,
      lastStatusAt: receivedAt,
    },
    {
      instanceId: instance.id,
      event: LogEvent.remote_deleted,
      source: LogSource.system,
      previousStatus: instance.status,
      newStatus: UazapiInstanceStatus.disconnected,
      message: "Instância não existe mais no servidor de WhatsApp",
    },
  );

/**
 * Toda chamada remota passa por aqui: o Result<T> vira exceção HTTP, e o caso "a instância sumiu do
 * provedor" é registrado localmente antes de responder — senão a tela ficaria oferecendo ações que
 * nunca mais vão funcionar.
 */
const callRemote = async <T>(instance: UazapiInstance, fn: (client: UazapiClient) => Promise<Result<T>>) => {
  const config = requireIntegration();
  const result = await fn(instanceClient(config, instance.tokenEnc));
  if (!result.success) {
    if (isInstanceGone(result.error)) {
      await markRemoteDeleted(instance, new Date());
      throw remoteDeletedError();
    }
    throw uazapiError(result.error);
  }
  return result.data;
};

export const get = async (orgId: string) => {
  const instance = await repo.findByOrg(orgId);
  return instance ? serializeInstance(instance) : null;
};

export const create = async (orgId: string, data: CreateInstanceInput, actor: Actor) => {
  await requireManager(orgId, actor);
  const config = requireIntegration();

  if (await repo.findByOrg(orgId)) {
    throw conflict("INSTANCE_ALREADY_EXISTS", "Esta imobiliária já tem um WhatsApp conectado");
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { slug: true },
  });
  const name = data.name ?? org.slug;

  const created = await adminClient(config).admin.createInstance({
    name,
    // rastreio no painel da uazapi: dá para saber de quem é a instância sem consultar o nosso banco
    adminField01: orgId,
    adminField02: "eloscrm",
  });
  if (!created.success) throw uazapiError(created.error);

  const token = created.data.token;
  const remote = created.data.instance ?? {};
  if (!token || !remote.id) {
    throw uazapiError({ status: 502, error: "resposta de criação sem token ou id de instância" });
  }

  const instance = await repo.create({
    organizationId: orgId,
    remoteId: remote.id,
    name,
    tokenEnc: encryptToken(token),
    tokenLast4: last4(token),
    tokenHash: hashToken(token),
    webhookSecret: newWebhookSecret(),
    status: parseStatus(remote.status) ?? UazapiInstanceStatus.disconnected,
  });

  await repo.writeLog({
    instanceId: instance.id,
    event: LogEvent.created,
    source: LogSource.manual,
    actorUserId: actor.id,
    newStatus: instance.status,
    message: `instância "${name}" criada`,
    payload: created.data,
  });

  // A instância já existe no provedor e o token é o único jeito de alcançá-la: apagar o registro
  // local aqui deixaria uma instância órfã consumindo o limite do servidor. Falha recuperável —
  // a tela mostra o aviso e o botão Reconciliar.
  const configured = await registerWebhook(config, instance, token, actor.id).catch(() => false);

  return { ...serializeInstance(instance), webhookConfigured: configured };
};

const registerWebhook = async (
  config: IntegrationConfig,
  instance: UazapiInstance,
  token: string,
  actorUserId: string,
) => {
  const result = await tokenClient(config, token).webhook.upsert({
    url: webhookUrl(config, instance.id, instance.webhookSecret),
    enabled: true,
    events: [...WEBHOOK_EVENTS],
    // sem este filtro, mensagem que nós mesmos enviarmos volta como evento e vira laço
    excludeMessages: ["wasSentByApi"],
    addUrlEvents: false,
  });

  await repo.writeLog({
    instanceId: instance.id,
    event: result.success ? LogEvent.webhook_configured : LogEvent.error,
    source: LogSource.manual,
    actorUserId,
    message: result.success ? "webhook registrado" : `falha ao registrar webhook: ${result.error.error}`,
    // Sem o payload de propósito: a uazapi devolve o webhook que acabou de gravar, e a `url` dele
    // termina no webhookSecret. `omitSecrets` filtra por nome de chave e não pegaria isso.
    payload: result.success ? undefined : { status: result.error.status, error: result.error.error },
  });

  return result.success;
};

export const rename = async (orgId: string, data: RenameInstanceInput, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  await callRemote(instance, (client) => client.instance.updateName({ name: data.name }));

  const updated = await repo.updateAndLog(
    instance.id,
    { name: data.name },
    {
      instanceId: instance.id,
      event: LogEvent.name_updated,
      source: LogSource.manual,
      actorUserId: actor.id,
      message: `${instance.name} → ${data.name}`,
    },
  );
  return serializeInstance(updated);
};

export const remove = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);

  if (!instance.remoteDeletedAt) {
    const config = requireIntegration();
    const result = await instanceClient(config, instance.tokenEnc).instance.delete();
    // "já sumiu do provedor" é exatamente o estado que queremos alcançar — não é erro
    if (!result.success && !isInstanceGone(result.error)) throw uazapiError(result.error);
  }

  await repo.remove(instance.id);
};

export const connect = async (orgId: string, data: ConnectInstanceInput, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  const result = await callRemote(instance, (client) => client.instance.connect(data));
  const remote = (result.instance ?? {}) as unknown as Record<string, unknown>;
  const updateData = applyInstanceSnapshot(remote, new Date());

  const updated = await repo.updateAndLog(instance.id, updateData, {
    instanceId: instance.id,
    event: updateData.qrcode
      ? LogEvent.qr_generated
      : updateData.paircode
        ? LogEvent.paircode_generated
        : LogEvent.connect_requested,
    source: LogSource.manual,
    actorUserId: actor.id,
    previousStatus: instance.status,
    newStatus: parseStatus(remote.status) ?? instance.status,
    payload: result,
  });
  return serializeInstance(updated);
};

export const disconnect = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  const result = await callRemote(instance, (client) => client.instance.disconnect());

  const now = new Date();
  const updated = await repo.updateAndLog(
    instance.id,
    {
      status: UazapiInstanceStatus.disconnected,
      lastStatusAt: now,
      lastDisconnectAt: now,
      lastDisconnectReason: "desconectado pelo painel",
      qrcode: null,
      paircode: null,
    },
    {
      instanceId: instance.id,
      event: LogEvent.disconnected,
      source: LogSource.manual,
      actorUserId: actor.id,
      previousStatus: instance.status,
      newStatus: UazapiInstanceStatus.disconnected,
      payload: result,
    },
  );
  return serializeInstance(updated);
};

export const reset = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  const result = await callRemote(instance, (client) => client.instance.reset());

  await repo.writeLog({
    instanceId: instance.id,
    event: LogEvent.reset,
    source: LogSource.manual,
    actorUserId: actor.id,
    payload: result,
  });
  return { ok: true };
};

export const sync = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  const result = await callRemote(instance, (client) => client.instance.status());
  const remote = (result.instance ?? {}) as unknown as Record<string, unknown>;
  const nextStatus = parseStatus(remote.status) ?? instance.status;

  const updated = await repo.updateAndLog(instance.id, applyInstanceSnapshot(remote, new Date()), {
    instanceId: instance.id,
    event: LogEvent.synced,
    source: LogSource.sync,
    actorUserId: actor.id,
    previousStatus: instance.status,
    newStatus: nextStatus,
    message: `sync: ${str(remote.status) ?? "desconhecido"}`,
    payload: result,
  });
  return serializeInstance(updated);
};

export const waLimits = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);
  return callRemote(instance, (client) => client.instance.waMessagesLimits());
};

export const getWebhook = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  const config = requireIntegration();
  const hooks = await callRemote(instance, (client) => client.webhook.get());
  const expected = webhookUrl(config, instance.id, instance.webhookSecret);

  return (hooks ?? []).map((hook) => ({
    id: hook.id,
    enabled: hook.enabled,
    events: hook.events,
    excludeMessages: hook.excludeMessages,
    // a URL registrada carrega o segredo no fim; o gestor não precisa dele para reconciliar
    url: maskWebhookUrl(hook.url),
    isOurs: hook.url === expected,
  }));
};

export const reconcileWebhook = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);

  const config = requireIntegration();
  await callRemote(instance, (client) =>
    client.webhook.upsert({
      url: webhookUrl(config, instance.id, instance.webhookSecret),
      enabled: true,
      events: [...WEBHOOK_EVENTS],
      excludeMessages: ["wasSentByApi"],
      addUrlEvents: false,
    }),
  );

  await repo.writeLog({
    instanceId: instance.id,
    event: LogEvent.webhook_configured,
    source: LogSource.manual,
    actorUserId: actor.id,
    message: "webhook reconciliado",
  });
  return { ok: true };
};

export const webhookErrors = async (orgId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  guardRemoteAlive(instance);
  return callRemote(instance, (client) => client.webhook.errors());
};

export const logs = async (orgId: string, query: ListLogsQuery, actor: Actor) => {
  await requireManager(orgId, actor);
  const instance = await requireInstance(orgId);
  return repo.listLogs(instance.id, query.limit, query.cursor);
};
