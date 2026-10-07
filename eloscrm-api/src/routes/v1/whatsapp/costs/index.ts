import * as z from "zod";
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { env } from "../../../../env.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import * as schema from "../../../../modules/whatsapp-costs/costs.schema.js";
import * as service from "../../../../modules/whatsapp-costs/costs.service.js";
import { syncAnalytics } from "../../../../modules/whatsapp-costs/analytics.service.js";
import { assessPeriod } from "../../../../modules/whatsapp-costs/assessment.repo.js";

const costRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  const requests = new Map<string, { at: number; count: number }>();
  app.addHook("preHandler", async request => {
    await service.requireManager(request.orgId!, request.user!.id);
    if (request.method === "GET") return;
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada");
    const now = Date.now(); const key = request.user!.id; const bucket = requests.get(key);
    if (!bucket || now - bucket.at >= 60000) { if (requests.size > 2000) requests.clear(); requests.set(key, { at: now, count: 1 }); }
    else if (++bucket.count > 20) throw httpError(429, "COST_RATE_LIMIT", "Aguarde um minuto antes de consultar novamente");
  });
  const options = { bodyLimit: 16384, logLevel: "silent" as const };
  app.get("/", async request => service.report(request.orgId!, schema.reportSchema.parse(request.query)));
  app.get("/scopes", async request => service.scopeOptions(request.orgId!, z.strictObject({ connectionId: z.string().min(1).max(128) }).parse(request.query).connectionId));
  app.get("/rates", async request => service.listRates(request.orgId!, z.strictObject({ connectionId: z.string().min(1).max(128) }).parse(request.query).connectionId));
  app.post("/rates", options, async request => service.addRate(request.orgId!, schema.rateSchema.parse(request.body), request.user!.id));
  app.post("/rates/import", { ...options, bodyLimit: 131072 }, async request => service.importRates(request.orgId!, schema.rateImportSchema.parse(request.body), request.user!.id));
  app.post("/recipient-country", options, async request => service.setRecipientCountry(request.orgId!, schema.recipientCountrySchema.parse(request.body)));
  app.get("/reconciliations", async request => service.listReconciliations(request.orgId!, schema.periodSchema.parse(request.query)));
  app.post("/reconciliations", options, async request => service.reconcile(request.orgId!, schema.reconciliationSchema.parse(request.body), request.user!.id));
  app.post("/simulate", options, async request => service.simulate(request.orgId!, schema.simulationSchema.parse(request.body)));
  app.post("/preview", options, async request => service.preview(request.orgId!, schema.previewSchema.parse(request.body)));
  app.post("/sync", options, async request => syncAnalytics(request.orgId!, schema.periodSchema.parse(request.body)));
  app.post("/assess", options, async request => assessPeriod(request.orgId!, schema.periodSchema.parse(request.body)));
};
export default costRoutes;
