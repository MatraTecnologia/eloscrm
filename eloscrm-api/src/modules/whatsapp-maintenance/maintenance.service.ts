import { forbidden } from "../../lib/http-error.js";
import { isOrgManager } from "../../lib/org-roles.js";
import type { Actor } from "../../lib/actor.js";
import { SYSTEM_ACTOR } from "../../lib/actor.js";
import { env } from "../../env.js";
import { recordAudit } from "../../lib/audit.js";
import * as history from "./history.repo.js";
import * as retention from "./retention.repo.js";
import { disableConnection } from "./lifecycle.repo.js";

const requireManager = async (orgId: string, actor: Actor) => {
  if (!await isOrgManager(orgId, actor.id)) throw forbidden("Apenas o dono ou um gestor pode administrar o histórico e as conexões");
};

export const backfillHistory = async (orgId: string, input: { apply: boolean; cursor?: string }, actor: Actor) => {
  await requireManager(orgId, actor);
  const rows = await history.legacyConversations(orgId, input.cursor);
  const items = [];
  for (const row of rows) {
    try { items.push(await history.linkUazapiConversation(orgId, row.id, input.apply)); }
    catch (error) {
      items.push({ id: row.id, status: "review", code: error instanceof Error && "expose" in error && error.expose === true && "code" in error ? String(error.code) : "UAZAPI_HISTORY_RETRY" });
    }
  }
  const changed = items.filter(item => "modified" in item && item.modified);
  if (input.apply && changed.length) await recordAudit({ orgId, entityType: "ORGANIZATION", entityId: orgId, action: "LINKED", actor, context: { operation: "uazapi_history_backfill", linked: changed.length, review: items.filter(item => item.status === "review").length } });
  return { apply: input.apply, items, nextCursor: rows.length === 100 ? rows.at(-1)!.id : null };
};

const cutoffs = () => ({
  journalBefore: new Date(Date.now() - env.WHATSAPP_JOURNAL_RETENTION_DAYS * 86_400_000),
  commandBefore: new Date(Date.now() - env.WHATSAPP_COMMAND_RETENTION_DAYS * 86_400_000),
});

const purgeBatch = async (orgId: string, apply: boolean, actor: Actor) => {
  const { journalBefore, commandBefore } = cutoffs();
  const [journals, commands] = await retention.retentionCandidates(orgId, journalBefore, commandBefore);
  const counts = apply ? await retention.sanitizePayloads(orgId, journalBefore, commandBefore, journals.map(row => row.id), commands.map(row => row.id), actor) : { journalPayloads: journals.length, commandPayloads: commands.length };
  return { apply, ...counts, journalBefore, commandBefore, hasMore: journals.length === 500 || commands.length === 500, journalDays: env.WHATSAPP_JOURNAL_RETENTION_DAYS, commandDays: env.WHATSAPP_COMMAND_RETENTION_DAYS };
};

export const purgePayloads = async (orgId: string, apply: boolean, actor: Actor) => {
  await requireManager(orgId, actor);
  return purgeBatch(orgId, apply, actor);
};

export const disable = async (orgId: string, connectionId: string, actor: Actor) => {
  await requireManager(orgId, actor);
  return disableConnection(orgId, connectionId, actor);
};

export const runWhatsappRetention = async () => {
  const { journalBefore, commandBefore } = cutoffs();
  for (const orgId of await retention.retentionOrganizations(journalBefore, commandBefore)) await purgeBatch(orgId, true, SYSTEM_ACTOR);
};

export const scheduleWhatsappRetention = () => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runWhatsappRetention(); } catch { /* O próximo ciclo reavalia somente payloads terminais não expurgados. */ } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
};
