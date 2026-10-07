import * as z from "zod";
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { requireManager } from "../../../../modules/whatsapp-costs/costs.service.js";
import { env } from "../../../../env.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import { actorOf } from "../../../../lib/actor.js";
import { recordAudit } from "../../../../lib/audit.js";
import * as repo from "../../../../modules/lead-automation/inbound-automation.repo.js";
import { enqueueInboundAutomation } from "../../../../modules/lead-automation/inbound-automation.service.js";

const routes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard); app.addHook("preHandler", orgGuard);
  app.addHook("preHandler", request => requireManager(request.orgId!, request.user!.id));
  const requests = new Map<string, { at: number; count: number }>();
  app.get("/", async request => {
    z.strictObject({}).parse(request.query);
    return (await repo.list(request.orgId!)).map(({ conversation, ...row }) => ({ ...row, name: conversation.client?.name ?? conversation.messagingContact?.displayName ?? conversation.contactName ?? conversation.waName ?? "Contato do WhatsApp" }));
  });
  app.post("/:messageId/retry", { bodyLimit: 1024, logLevel: "silent" }, async request => {
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada");
    z.strictObject({}).parse(request.body);
    const { messageId } = z.strictObject({ messageId: z.string().min(1).max(128) }).parse(request.params);
    const now = Date.now(); const key = request.user!.id; const bucket = requests.get(key);
    if (!bucket || now - bucket.at >= 60000) { if (requests.size > 2000) requests.clear(); requests.set(key, { at: now, count: 1 }); }
    else if (++bucket.count > 20) throw httpError(429, "AUTOMATION_RATE_LIMIT", "Aguarde um minuto antes de reprocessar novamente");
    if (!(await repo.retry(request.orgId!, messageId)).count) throw httpError(409, "AUTOMATION_NOT_FAILED", "Não há automação com falha nesta imobiliária para reprocessar");
    await recordAudit({ orgId: request.orgId!, entityType: "WHATSAPP_MESSAGE", entityId: messageId, action: "UPDATED", actor: actorOf(request), context: { operation: "inbound_automation_retry" } });
    await enqueueInboundAutomation({ organizationId: request.orgId!, messageId }).catch(() => undefined);
    return { queued: true };
  });
};
export default routes;
