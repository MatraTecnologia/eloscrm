import * as z from "zod";
import { CostDecimal } from "./money.js";
import { requestGraph } from "../../lib/whatsapp-official/graph.js";
import { getOfficialCredentials } from "../channel-connections/channel-connections.service.js";
import { eventHash } from "../whatsapp-official/webhook.schema.js";
import { getConnection } from "./costs.service.js";
import * as repo from "./costs.repo.js";
import type { Period } from "./costs.schema.js";

const pointSchema = z.looseObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), country: z.string().max(64).optional(), pricing_category: z.string().max(64).optional(), pricing_type: z.string().max(64).optional(), tier: z.string().max(64).optional(), volume: z.number().int().nonnegative().max(2000000000).optional(), cost: z.union([z.number().nonnegative().finite(), z.string().regex(/^\d{1,12}(\.\d{1,10})?$/)]).optional() });
const responseSchema = z.looseObject({ currency: z.string().regex(/^[A-Z]{3}$/), pricing_analytics: z.looseObject({ data: z.array(z.looseObject({ data_points: z.array(pointSchema).max(5000) })).max(100) }) });

export const syncAnalytics = async (orgId: string, input: Period) => {
  const channel = await getConnection(orgId, input.connectionId);
  const startedAt = new Date();
  try {
    const credentials = await getOfficialCredentials(orgId, channel.id);
    const start = Math.floor(Date.parse(input.start) / 1000);
    const end = Math.floor(Date.parse(input.end) / 1000);
    const raw = responseSchema.parse(await requestGraph(channel.wabaId!, credentials.accessToken, { fields: `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE,TIER,COUNTRY).metric_types(COST,VOLUME)` }));
    if (raw.paging || raw.pricing_analytics.paging || raw.pricing_analytics.data.some(entry => entry.paging)) throw new Error("Resposta parcial");
    const all = raw.pricing_analytics.data.flatMap(entry => entry.data_points);
    if (all.length > 5000 || all.some(point => point.start < start || point.end > end || point.end <= point.start)) throw new Error("Recorte inválido");
    const unique = new Map<string, z.infer<typeof pointSchema>>();
    for (const point of all) {
      const key = JSON.stringify([point.start, point.end, point.country, point.pricing_category, point.pricing_type, point.tier]);
      const previous = unique.get(key);
      if (previous && eventHash(previous) !== eventHash(point)) throw new Error("Dimensões duplicadas");
      unique.set(key, point);
    }
    const points = [...unique.values()].map(point => ({ start: point.start, end: point.end, country: point.country ?? null, category: point.pricing_category ?? null, pricingType: point.pricing_type ?? null, tier: point.tier ?? null, volume: point.volume ?? null, cost: point.cost === undefined ? null : new CostDecimal(point.cost).toFixed() })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const hasCost = points.length > 0 && points.every(point => point.cost !== null);
    const hasVolume = points.length > 0 && points.every(point => point.volume !== null);
    const total = hasCost ? points.reduce((sum, point) => sum.plus(point.cost!), new CostDecimal(0)) : null;
    const volume = hasVolume ? points.reduce((sum, point) => sum + point.volume!, 0) : null;
    return repo.saveAnalytics(orgId, channel.wabaId!, input, startedAt, { currency: raw.currency, status: hasCost ? "available" : "no_cost", points, total, volume, contentHash: eventHash({ currency: raw.currency, points }), safeError: hasCost ? null : "A Meta não retornou custo para todo o recorte; não equivale a gasto zero" });
  } catch {
    await repo.saveAnalytics(orgId, channel.wabaId!, input, startedAt, { currency: channel.currency, status: "unavailable", safeError: "Não foi possível sincronizar os custos da Meta. O último snapshot, se existir, foi preservado." });
    return { status: "unavailable" };
  }
};
