import * as z from "zod";
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { env } from "../../../../env.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import { actorOf } from "../../../../lib/actor.js";
import { requireManager } from "../../../../modules/whatsapp-costs/costs.service.js";
import * as schema from "../../../../modules/whatsapp-campaigns/campaigns.schema.js";
import * as service from "../../../../modules/whatsapp-campaigns/campaigns.service.js";
import { preview } from "../../../../modules/whatsapp-campaigns/preview.service.js";
import { list } from "../../../../modules/whatsapp-campaigns/campaigns.repo.js";
import { targets } from "../../../../modules/whatsapp-campaigns/targets.service.js";
import { broadcastFiltersSchema } from "../../../../modules/broadcasts/broadcasts.schema.js";
import "../../../../modules/whatsapp-campaigns/dispatch.service.js";

const campaignRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard); app.addHook("preHandler", orgGuard);
  const requests = new Map<string, { at: number; count: number }>();
  app.addHook("preHandler", async request => {
    await requireManager(request.orgId!, request.user!.id);
    if (request.method === "GET") return;
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada");
    const now = Date.now(); const key = request.user!.id; const bucket = requests.get(key);
    if (!bucket || now - bucket.at >= 60000) { if (requests.size > 2000) requests.clear(); requests.set(key, { at: now, count: 1 }); }
    else if (++bucket.count > 30) throw httpError(429, "CAMPAIGN_RATE_LIMIT", "Aguarde um minuto antes de tentar novamente");
  });
  const options = { bodyLimit: 131072, logLevel: "silent" as const };
  app.get("/", async request => list(request.orgId!, z.strictObject({ pipelineId: z.string().min(1).max(128) }).parse(request.query).pipelineId));
  app.post("/preview", options, async request => preview(request.orgId!, schema.campaignInputSchema.parse(request.body)));
  app.post("/targets", options, async request => { const input = z.strictObject({ pipelineId: z.string().min(1).max(128), filters: broadcastFiltersSchema.safeExtend({}).strict() }).parse(request.body); return targets(request.orgId!, input.pipelineId, input.filters); });
  app.post("/", options, async request => service.create(request.orgId!, schema.createSchema.parse(request.body), actorOf(request)));
  app.get("/:id", async request => service.get(request.orgId!, schema.idSchema.parse(request.params).id));
  app.post("/:id/preview", options, async request => { z.strictObject({}).parse(request.body); return service.repreview(request.orgId!, schema.idSchema.parse(request.params).id); });
  app.post("/:id/refresh", options, async request => service.approve(request.orgId!, schema.idSchema.parse(request.params).id, schema.approvalSchema.parse(request.body).previewHash, false, actorOf(request)));
  app.post("/:id/start", options, async request => service.approve(request.orgId!, schema.idSchema.parse(request.params).id, schema.approvalSchema.parse(request.body).previewHash, true, actorOf(request)));
  app.post("/:id/cancel", options, async request => { z.strictObject({}).parse(request.body); return service.cancel(request.orgId!, schema.idSchema.parse(request.params).id, actorOf(request)); });
  for (const action of ["pause", "resume"] as const) app.post(`/:id/${action}`, options, async request => { z.strictObject({}).parse(request.body); return service.changeState(request.orgId!, schema.idSchema.parse(request.params).id, action === "pause" ? "paused" : "running", actorOf(request)); });
};
export default campaignRoutes;
