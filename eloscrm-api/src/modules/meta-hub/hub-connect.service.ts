import { env } from "../../env.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, forbidden, httpError, notFound } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import { SYSTEM_ACTOR, type Actor } from "../../lib/actor.js";
import * as hub from "../../lib/meta-hub/client.js";
import { publicConnectionSelect } from "../channel-connections/channel-connections.repo.js";
import { applyHubConnection } from "./connection.service.js";

type Scope = { orgId: string; userId: string };

// A conexão pelo hub só abre com HUB_ENABLED: a M1 vai a produção desligada (§7 F1.5)
export const hubAvailable = () => Boolean(env.HUB_ENABLED && env.HUB_API_KEY);
export const configuration = () => ({ available: hubAvailable() });

const requireManager = async (scope: Scope) => {
  if (!await isOrgManager(scope.orgId, scope.userId)) throw forbidden("Somente gestores podem conectar o WhatsApp");
};

// sem query nem fragmento: o hub compara origin + pathname com a allowlist do app (hub:481)
export const returnUrl = () => `${new URL(env.WEB_ORIGIN).origin}/integracoes/whatsapp`;

const hubFailure = (error: unknown) => {
  if (!(error instanceof hub.HubError)) return error;
  if (error.code === "META_WEBHOOK_NOT_READY") return httpError(503, "HUB_NOT_READY", "A conexão está temporariamente indisponível; tente de novo em instantes");
  // configuração do app no hub (chave de outro app, allowlist de retorno): repetir não resolve
  if (error.code === "WORKSPACE_NOT_FOUND" || error.code === "RETURN_URL_NOT_ALLOWED") return httpError(503, "HUB_MISCONFIGURED", "A conexão pelo WhatsApp oficial está com a configuração incompleta; fale com o suporte");
  if (error.code === "WORKSPACE_DISABLED") return conflict("HUB_WORKSPACE_DISABLED", "A conexão pelo WhatsApp oficial está desativada para esta imobiliária; fale com o suporte");
  return httpError(502, "HUB_UNAVAILABLE", "Não foi possível falar com o serviço de conexão; tente de novo");
};

// POST /v1/workspaces é idempotente por externalId (hub:450): a corrida entre duas abas devolve o mesmo
const ensureWorkspace = async (orgId: string) => {
  const org = await prisma.organization.findFirstOrThrow({ where: { id: orgId }, select: { name: true, hubWorkspaceId: true } });
  if (org.hubWorkspaceId) return org.hubWorkspaceId;
  const workspace = await hub.ensureWorkspace(orgId, org.name.slice(0, 200) || orgId);
  await prisma.organization.updateMany({ where: { id: orgId, hubWorkspaceId: null }, data: { hubWorkspaceId: workspace.id } });
  return workspace.id;
};

export const startSession = async (scope: Scope) => {
  await requireManager(scope);
  if (!hubAvailable()) throw httpError(503, "INTEGRATION_NOT_CONFIGURED", "A conexão pelo WhatsApp oficial ainda não está disponível");
  try {
    const workspaceId = await ensureWorkspace(scope.orgId);
    // corpo estrito no hub (hub:497); só Coexistence (D7)
    const session = await hub.createConnectSession(workspaceId, { kind: "whatsapp", returnUrl: returnUrl(), requireCoexistence: true });
    // a url leva token de acesso (hub:507): sai só na resposta, nunca em log
    return { url: session.url, expiresAt: session.expiresAt };
  } catch (error) { throw hubFailure(error); }
};

const CONFLICTS: Record<string, string> = {
  WHATSAPP_NUMBER_UNAVAILABLE: "Este número já está vinculado a outra imobiliária",
  WHATSAPP_ASSET_CHANGED: "Os vínculos deste número mudaram; fale com o suporte para revisar a conexão",
  HUB_COMMANDS_PENDING: "Ainda há envios em andamento neste número; tente de novo em alguns minutos",
};

// Retorno do navegador com status=connected (§3.1): o query é só dica, a verdade é o GET
export const refresh = async (scope: Scope, hubConnectionId: string, actor: Actor) => {
  await requireManager(scope);
  const org = await prisma.organization.findFirst({ where: { id: scope.orgId }, select: { hubWorkspaceId: true } });
  if (!org?.hubWorkspaceId || !hubAvailable()) throw notFound("Conexão não encontrada");
  let connection: hub.HubConnection;
  try { connection = await hub.getConnection(hubConnectionId); }
  catch (error) {
    if (error instanceof hub.HubError && (error.status === 404 || error.code === "HUB_INVALID_ID")) throw notFound("Conexão não encontrada");
    throw hubFailure(error);
  }
  // id de outro workspace (hub:566) ou de Lead Ads: para esta org a conexão não existe
  if (connection.workspaceId !== org.hubWorkspaceId || connection.kind !== "whatsapp") throw notFound("Conexão não encontrada");
  const outcome = await applyHubConnection(scope.orgId, connection, { fromGet: true, fromReturn: true, actor });
  if (outcome.code && CONFLICTS[outcome.code]) throw conflict(outcome.code, CONFLICTS[outcome.code]);
  // desativada sem sessão nova (HUB_CONNECTION_DISABLED) devolve a linha como está
  if (!outcome.connectionId) throw notFound("Conexão não encontrada");
  return prisma.channelConnection.findFirstOrThrow({ where: { id: outcome.connectionId, organizationId: scope.orgId }, select: publicConnectionSelect });
};

// Varredura do workspace: a emissão do evento da conclusão é best-effort no hub (§3.1), e currency e
// timezone mudam sem evento (hub:605). Chamada pelo job diário, só com HUB_JOBS_ENABLED.
export const refreshWorkspaceConnections = async (orgId: string, workspaceId: string) => {
  const connections = await hub.listConnections(workspaceId);
  const outcomes = [];
  for (const connection of connections) {
    if (connection.kind !== "whatsapp" || connection.workspaceId !== workspaceId) continue;
    outcomes.push(await applyHubConnection(orgId, connection, { fromGet: true, actor: SYSTEM_ACTOR }));
  }
  return outcomes;
};
