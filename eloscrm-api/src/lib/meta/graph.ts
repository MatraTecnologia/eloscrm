import axios, { AxiosError } from "axios";
import { env } from "../../env.js";

/**
 * Cliente mínimo da Graph API do Meta para Lead Ads.
 *
 * Só leitura, e só o que o cron precisa: quem é o token, as páginas a que ele dá acesso, os
 * formulários de cada página e os leads de cada formulário. Sem SDK: são quatro GETs, e o SDK
 * oficial de Node está abandonado desde 2018.
 */

export type GraphErrorPayload = {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

export type MetaMe = { id: string; name: string };
export type MetaPageNode = { id: string; name: string; access_token: string };
export type MetaFormNode = { id: string; name: string; status?: string; leads_count?: number };
export type MetaFieldDatum = { name: string; values: string[] };
export type MetaLeadNode = {
  id: string;
  created_time: string;
  field_data?: MetaFieldDatum[];
  ad_name?: string;
  campaign_name?: string;
  platform?: string;
};

type Page<T> = { data: T[]; paging?: { next?: string } };

export class MetaGraphError extends Error {
  constructor(
    readonly graph: GraphErrorPayload | null,
    readonly network: boolean,
  ) {
    super(graph?.message ?? (network ? "Meta não respondeu" : "Erro na Graph API do Meta"));
  }

  /** 190 é token inválido/expirado; 102 é sessão inválida. Nos dois, só trocar o token resolve. */
  get tokenInvalid() {
    return this.graph?.code === 190 || this.graph?.code === 102;
  }
}

const http = axios.create({
  baseURL: `https://graph.facebook.com/${env.META_GRAPH_VERSION}`,
  timeout: 30_000,
});

const toGraphError = (err: unknown) => {
  if (err instanceof MetaGraphError) return err;
  const axiosErr = err instanceof AxiosError ? err : null;
  const payload = (axiosErr?.response?.data as { error?: GraphErrorPayload } | undefined)?.error;
  if (payload) return new MetaGraphError(payload, false);
  return new MetaGraphError(null, true);
};

const get = async <T>(path: string, token: string, params: Record<string, string | number> = {}) => {
  try {
    const { data } = await http.get<T>(path, { params: { ...params, access_token: token } });
    return data;
  } catch (err) {
    throw toGraphError(err);
  }
};

// teto de páginas por chamada: um formulário com milhares de leads acumulados não pode segurar o
// cron de todo mundo — o que sobrar vem na próxima rodada, pela marca d'água
const MAX_PAGES = 10;

const getAll = async <T>(path: string, token: string, params: Record<string, string | number>) => {
  const items: T[] = [];
  let page = await get<Page<T>>(path, token, params);
  items.push(...page.data);
  for (let i = 1; i < MAX_PAGES && page.paging?.next; i++) {
    try {
      // `next` já vem com todos os parâmetros, token incluído
      page = (await http.get<Page<T>>(page.paging.next)).data;
    } catch (err) {
      throw toGraphError(err);
    }
    items.push(...page.data);
  }
  return items;
};

export const me = (token: string) => get<MetaMe>("/me", token, { fields: "id,name" });

export const pages = (token: string) =>
  getAll<MetaPageNode>("/me/accounts", token, { fields: "id,name,access_token", limit: 100 });

export const leadForms = (pageId: string, pageToken: string) =>
  getAll<MetaFormNode>(`/${pageId}/leadgen_forms`, pageToken, {
    fields: "id,name,status,leads_count",
    limit: 100,
  });

/** Leads criados depois de `since`; sem `since`, os mais recentes. */
export const leads = (formId: string, pageToken: string, since: Date | null) =>
  getAll<MetaLeadNode>(`/${formId}/leads`, pageToken, {
    fields: "id,created_time,field_data,ad_name,campaign_name,platform",
    limit: 100,
    ...(since
      ? {
          filtering: JSON.stringify([
            {
              field: "time_created",
              operator: "GREATER_THAN",
              value: Math.floor(since.getTime() / 1000),
            },
          ]),
        }
      : {}),
  });
