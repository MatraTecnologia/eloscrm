import { env } from "../../env.js";

// O erro carrega somente códigos: URLs, headers e mensagens da Meta podem conter segredos.
export class OfficialGraphError extends Error {
  constructor(readonly code: number | null, readonly uncertain: boolean) { super("Não foi possível concluir a operação na Meta"); }
}

export const requestGraph = async (path: string, token: string | null, params: Record<string, string> = {}, body?: Record<string, unknown>, method?: "DELETE") => {
  const url = new URL(`https://graph.facebook.com/${env.META_WHATSAPP_GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      method: method ?? (body ? "POST" : "GET"), redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new OfficialGraphError(null, true); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new OfficialGraphError(null, true); }
  if (!response.ok || (data && typeof data === "object" && "error" in data)) {
    const code = data && typeof data === "object" && "error" in data && data.error && typeof data.error === "object" && "code" in data.error && typeof data.error.code === "number" ? data.error.code : null;
    throw new OfficialGraphError(code, response.status >= 500);
  }
  return data;
};

export const exchangeCode = (code: string) => requestGraph("oauth/access_token", null, {
  client_id: env.META_WHATSAPP_APP_ID!, client_secret: env.META_WHATSAPP_APP_SECRET!, code,
});
export const inspectToken = (token: string) => requestGraph("debug_token", `${env.META_WHATSAPP_APP_ID}|${env.META_WHATSAPP_APP_SECRET}`, { input_token: token });
export const readWaba = (token: string, id: string) => requestGraph(id, token, { fields: "id,owner_business_info,currency,timezone_id" });
export const readPhone = (token: string, id: string) => requestGraph(id, token, { fields: "id,display_phone_number,verified_name,is_on_biz_app,platform_type" });
export const readAppSubscriptions = () => requestGraph(`${env.META_WHATSAPP_APP_ID}/subscriptions`, `${env.META_WHATSAPP_APP_ID}|${env.META_WHATSAPP_APP_SECRET}`);
export const subscribeWaba = (token: string, id: string) => requestGraph(`${id}/subscribed_apps`, token, {}, {});
export const requestSync = (token: string, id: string, syncType: string) => requestGraph(`${id}/smb_app_data`, token, {}, { messaging_product: "whatsapp", sync_type: syncType });
export const sendMessage = (token: string, id: string, payload: Record<string, unknown>) => requestGraph(`${id}/messages`, token, {}, payload);

export const readTemplates = async (token: string, wabaId: string, name?: string) => {
  const entries: unknown[] = [];
  let after: string | undefined;
  for (let index = 0; index < 20; index++) {
    const page = await requestGraph(`${wabaId}/message_templates`, token, { fields: "id,name,language,category,status,parameter_format,components", limit: "100", ...(name ? { name } : {}), ...(after ? { after } : {}) });
    if (!page || typeof page !== "object" || !("data" in page) || !Array.isArray(page.data)) throw new OfficialGraphError(null, false);
    entries.push(...page.data);
    const paging = "paging" in page ? page.paging : null;
    if (!paging || typeof paging !== "object" || !("next" in paging)) return entries;
    const cursors = "cursors" in paging ? paging.cursors : null;
    const cursor = cursors && typeof cursors === "object" && "after" in cursors ? cursors.after : null;
    if (typeof cursor !== "string" || cursor.length > 2048 || cursor === after) throw new OfficialGraphError(null, false);
    after = cursor;
  }
  throw new OfficialGraphError(null, false);
};

export const uploadMedia = async (token: string, phoneNumberId: string, buffer: Buffer, mime: string, filename: string) => {
  const body = new FormData();
  body.set("messaging_product", "whatsapp");
  body.set("type", mime);
  body.set("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${env.META_WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/media`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}` }, body });
  } catch { throw new OfficialGraphError(null, true); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new OfficialGraphError(null, true); }
  if (!response.ok || !data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string" || !/^\d{1,128}$/.test(data.id)) throw new OfficialGraphError(null, response.status >= 500);
  return data.id;
};

export const readPhones = async (token: string, wabaId: string) => {
  const pages: unknown[] = [];
  let after: string | undefined;
  for (let index = 0; index < 20; index++) {
    const page = await requestGraph(`${wabaId}/phone_numbers`, token, {
      fields: "id,display_phone_number,verified_name,is_on_biz_app,platform_type", limit: "100", ...(after ? { after } : {}),
    });
    pages.push(page);
    const paging = page && typeof page === "object" && "paging" in page ? page.paging : null;
    if (!paging || typeof paging !== "object" || !("next" in paging)) return pages;
    const cursors = "cursors" in paging ? paging.cursors : null;
    const cursor = cursors && typeof cursors === "object" && "after" in cursors ? cursors.after : null;
    if (typeof cursor !== "string" || cursor.length > 2048) throw new OfficialGraphError(null, false);
    after = cursor;
  }
  // Não segue paging.next: ele pode conter token e redirecionar para outro host.
  throw new OfficialGraphError(null, false);
};

export const readMediaMetadata = (token: string, mediaId: string, phoneNumberId: string) => {
  if (!/^\d{1,128}$/.test(mediaId) || !/^\d{1,128}$/.test(phoneNumberId)) throw new OfficialGraphError(null, false);
  return requestGraph(mediaId, token, { phone_number_id: phoneNumberId });
};

export const createTemplate = (token: string, wabaId: string, definition: Record<string, unknown>) => requestGraph(`${wabaId}/message_templates`, token, {}, definition);
export const deleteTemplate = (token: string, wabaId: string, id: string, name: string) => requestGraph(`${wabaId}/message_templates`, token, { hsm_id: id, name }, undefined, "DELETE");
