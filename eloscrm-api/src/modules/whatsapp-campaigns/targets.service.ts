import { httpError, notFound } from "../../lib/http-error.js";
import * as deals from "../broadcasts/broadcasts.repo.js";
import { replyThreads } from "./campaigns.repo.js";
import type { BroadcastFilters } from "../broadcasts/broadcasts.schema.js";

export const filterReplies = async (orgId: string, targets: deals.MatchedDeal[], filters: BroadcastFilters) => {
  if (!filters.reply || !targets.length) return targets;
  const clients = targets.map(value => value.client.id);
  const conversations = await replyThreads(orgId, clients);
  const latest = new Map<string, { direction: string; sentAt: Date }>();
  for (const thread of conversations) {
    const id = thread.messagingContact?.clientId ?? thread.clientId; const message = thread.messages[0];
    if (id && message && (!latest.has(id) || latest.get(id)!.sentAt < message.sentAt)) latest.set(id, message);
  }
  return targets.filter(deal => { const message = latest.get(deal.client.id); return message && (filters.reply === "REPLIED" ? message.direction === "inbound" : message.direction === "outbound" && (!filters.noReplyDays || message.sentAt.getTime() <= Date.now() - filters.noReplyDays * 86400000)); });
};
export const targets = async (orgId: string, pipelineId: string, filters: BroadcastFilters) => {
  if (!await deals.findPipeline(orgId, pipelineId)) throw notFound("Funil não encontrado");
  const matched = await deals.matchDeals(orgId, pipelineId, filters, { limit: 501 });
  if (matched.length > 500) throw httpError(422, "CAMPAIGN_TARGET_LIMIT", "Restrinja os filtros: limite de 500 negócios por consulta");
  const rows = await filterReplies(orgId, matched, filters);
  const owners = await deals.memberNames(orgId, [...new Set(rows.flatMap(row => row.ownerId ? [row.ownerId] : []))]);
  return rows.map(deal => ({ dealId: deal.id, title: deal.title, value: deal.value, stageId: deal.stageId, propertyTitle: deal.property?.title ?? null, ownerName: deal.ownerId ? owners.get(deal.ownerId) ?? null : null, tags: deal.tags, client: deal.client, sendable: true }));
};
