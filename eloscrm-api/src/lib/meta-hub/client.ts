import { env } from "../../env.js";
import { httpError } from "../http-error.js";
import type { paths } from "./openapi.js";

// Respostas tipadas pelo OpenAPI do hub (openapi.d.ts, gerado). Campo novo chega sem aviso além do
// changelog, então nada aqui valida a resposta em modo estrito.
type Json<P extends keyof paths, M extends keyof paths[P], S extends number> =
  paths[P][M] extends { responses: infer R } ? S extends keyof R ? R[S] extends { content: { "application/json": infer B } } ? B : never : never : never;
type Body<P extends keyof paths, M extends keyof paths[P]> =
  paths[P][M] extends { requestBody: { content: { "application/json": infer B } } } ? B : never;

export type HubConnection = Json<"/v1/connections/{connectionId}", "get", 200>["connection"];
export type HubWorkspace = Json<"/v1/workspaces", "post", 201>["workspace"];
export type HubMessage = Json<"/v1/connections/{connectionId}/messages/{messageId}", "get", 200>["message"];
export type HubMessageBody = Body<"/v1/connections/{connectionId}/messages", "post">;
export type HubTemplate = Json<"/v1/connections/{connectionId}/templates/{templateId}", "get", 200>["template"];
export type HubTemplateBody = Body<"/v1/connections/{connectionId}/templates", "post">;
export type HubMedia = Json<"/v1/media/{mediaId}", "get", 200>["media"];
export type HubPage<T> = { data: T[]; meta: { total: number; page: number; limit: number; totalPages: number; hasNext: boolean } };

// Só códigos saem daqui: a `message` do hub vem traduzida e não decide nada (hub:377). `uncertain`
// marca o que pode ter sido aplicado no hub (rede, timeout, 5xx): quem chama não repete às cegas.
export class HubError extends Error {
  constructor(readonly status: number | null, readonly code: string | null, readonly retryAfter: number | null, readonly uncertain: boolean) {
    super("Não foi possível concluir a operação no Meta Hub");
  }
}

type RequestOptions = { query?: Record<string, string | number | undefined>; json?: unknown; raw?: { body: Buffer; contentType: string; filename?: string }; headers?: Record<string, string>; timeoutMs?: number };

const TIMEOUT_MS = 15_000;
// O upload é síncrono: o hub recebe o arquivo em até max(60 s, tamanho a 512 KB/s) e espera até 120 s
// pela Meta antes do 201 (código do hub, media-limits.ts e graph.ts). Abortar antes deixa mídia órfã.
const uploadTimeout = (bytes: number) => Math.max(60_000, Math.ceil(bytes / (512 * 1024)) * 1000) + 120_000 + TIMEOUT_MS;

// "." e ".." passam pelo encodeURIComponent e o new URL os colapsa: a chamada iria para outra rota
const segment = (value: string) => {
  if (value === "" || value === "." || value === "..") throw new HubError(null, "HUB_INVALID_ID", null, false);
  return encodeURIComponent(value);
};
// header só aceita Latin-1 sem controle; o nome é só exibição no hub (hub:821), então troca em vez de falhar
const headerSafe = (value: string) => value.replace(/[^\x20-\x7E\xA0-\xFF]/g, "_").slice(0, 255);

const parseRetryAfter = (value: string | null) => {
  const seconds = value === null ? NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};

export const hubRequest = async <T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, options: RequestOptions = {}): Promise<T> => {
  if (!env.HUB_API_KEY) throw httpError(503, "INTEGRATION_NOT_CONFIGURED", "A integração com o Meta Hub não está configurada");
  const url = new URL(env.HUB_API_URL.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  const headers = new Headers({ Authorization: `Bearer ${env.HUB_API_KEY}`, Accept: "application/json", ...options.headers });
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (options.raw) {
    headers.set("Content-Type", options.raw.contentType);
    const filename = options.raw.filename && headerSafe(options.raw.filename);
    if (filename) headers.set("X-Filename", filename);
    body = new Uint8Array(options.raw.body);
  } else if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  // montado fora do try: erro aqui é nosso, nada saiu da máquina, e não pode virar "incerto"
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    // redirect "error": o Bearer nunca acompanha um 3xx para outro host
    response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }), redirect: "error", signal });
  } catch { throw new HubError(null, null, null, true); }
  if (response.status === 204) return undefined as T;
  let data: unknown = null;
  try { data = await response.json(); } catch { if (response.ok) throw new HubError(response.status, null, null, true); }
  if (!response.ok) {
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : null;
    throw new HubError(response.status, code, parseRetryAfter(response.headers.get("retry-after")), response.status >= 500);
  }
  return data as T;
};

const list = async <T>(path: string, query: Record<string, string | number | undefined> = {}, maxPages = 50) => {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await hubRequest<HubPage<T>>("GET", path, { query: { ...query, page, limit: 100 } });
    items.push(...result.data);
    if (!result.meta.hasNext) return items;
  }
  throw new HubError(null, "HUB_PAGINATION_LIMIT", null, false);
};

const conn = (connectionId: string) => `/connections/${segment(connectionId)}`;

export const ensureWorkspace = (externalId: string, name: string) =>
  hubRequest<{ workspace: HubWorkspace }>("POST", "/workspaces", { json: { externalId, name } }).then(result => result.workspace);
export const deactivateWorkspace = (workspaceId: string) => hubRequest<unknown>("POST", `/workspaces/${segment(workspaceId)}/deactivate`);
export const createConnectSession = (workspaceId: string, body: Body<"/v1/workspaces/{workspaceId}/connect-sessions", "post">) =>
  hubRequest<Json<"/v1/workspaces/{workspaceId}/connect-sessions", "post", 201>>("POST", `/workspaces/${segment(workspaceId)}/connect-sessions`, { json: body });

export const getConnection = (connectionId: string) => hubRequest<{ connection: HubConnection }>("GET", conn(connectionId)).then(result => result.connection);
export const listConnections = (workspaceId?: string) => list<HubConnection>("/connections", { workspaceId });
export const deleteConnection = (connectionId: string) => hubRequest<{ connection: HubConnection }>("DELETE", conn(connectionId)).then(result => result.connection);

export const sendMessage = (connectionId: string, idempotencyKey: string, body: HubMessageBody) =>
  hubRequest<{ message: HubMessage }>("POST", `${conn(connectionId)}/messages`, { json: body, headers: { "Idempotency-Key": idempotencyKey } }).then(result => result.message);
export const getMessage = (connectionId: string, messageId: string) =>
  hubRequest<{ message: HubMessage }>("GET", `${conn(connectionId)}/messages/${segment(messageId)}`).then(result => result.message);
// achar é prova de que o hub recebeu o pedido; lista vazia só prova ausência naquele instante (hub:779)
export const findMessageByKey = (connectionId: string, idempotencyKey: string) =>
  hubRequest<HubPage<HubMessage>>("GET", `${conn(connectionId)}/messages`, { query: { idempotencyKey, limit: 1 } }).then(result => result.data[0] ?? null);

export const uploadMedia = (connectionId: string, file: { body: Buffer; contentType: string; filename?: string }) =>
  hubRequest<Json<"/v1/connections/{connectionId}/media", "post", 201>>("POST", `${conn(connectionId)}/media`, { raw: file, timeoutMs: uploadTimeout(file.body.length) });
export const getMedia = (mediaId: string) => hubRequest<{ media: HubMedia }>("GET", `/media/${segment(mediaId)}`).then(result => result.media);

type TemplatePage = Json<"/v1/connections/{connectionId}/templates", "get", 200>;
// O syncedAt da conta vem em toda página (hub:887). Se mudar no meio da leitura, uma sincronização
// terminou entre as páginas e a lista mistura duas rodadas: quem chama lê de novo.
export const listTemplates = async (connectionId: string) => {
  const items: HubTemplate[] = [];
  let syncedAt: string | null | undefined;
  // a sincronização do hub para em 6.500 templates por conta (hub:897)
  for (let page = 1; page <= 70; page++) {
    const result = await hubRequest<TemplatePage>("GET", `${conn(connectionId)}/templates`, { query: { page, limit: 100 } });
    if (syncedAt !== undefined && result.syncedAt !== syncedAt) throw new HubError(null, "HUB_TEMPLATES_RESYNCED", null, false);
    syncedAt = result.syncedAt;
    items.push(...(result.data as HubTemplate[]));
    if (!result.meta.hasNext) return { items, syncedAt };
  }
  throw new HubError(null, "HUB_PAGINATION_LIMIT", null, false);
};
// fim da sincronização pedida: relê com limit=1 até o syncedAt mudar (hub:893)
export const getTemplatesSyncedAt = (connectionId: string) =>
  hubRequest<TemplatePage>("GET", `${conn(connectionId)}/templates`, { query: { page: 1, limit: 1 } }).then(result => result.syncedAt);
export const getTemplate = (connectionId: string, templateId: string) =>
  hubRequest<{ template: HubTemplate }>("GET", `${conn(connectionId)}/templates/${segment(templateId)}`).then(result => result.template);
export const createTemplate = (connectionId: string, body: HubTemplateBody) =>
  hubRequest<{ template: HubTemplate }>("POST", `${conn(connectionId)}/templates`, { json: body }).then(result => result.template);
export const deleteTemplate = (connectionId: string, templateId: string) => hubRequest<void>("DELETE", `${conn(connectionId)}/templates/${segment(templateId)}`);
export const requestTemplateSync = (connectionId: string) =>
  hubRequest<Json<"/v1/connections/{connectionId}/templates/sync", "post", 202>>("POST", `${conn(connectionId)}/templates/sync`);

export const getConsumption = (connectionId: string, month?: string) =>
  hubRequest<Json<"/v1/connections/{connectionId}/consumption", "get", 200>>("GET", `${conn(connectionId)}/consumption`, { query: { month } });
export const getUsage = (connectionId: string) => hubRequest<Json<"/v1/connections/{connectionId}/usage", "get", 200>>("GET", `${conn(connectionId)}/usage`);
