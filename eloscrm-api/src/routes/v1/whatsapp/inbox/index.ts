import * as z from "zod";
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { actorOf } from "../../../../lib/actor.js";
import { env } from "../../../../env.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import * as manual from "../../../../modules/whatsapp-inbox/uazapi-manual.service.js";
import * as schema from "../../../../modules/whatsapp-inbox/inbox.schema.js";
import * as service from "../../../../modules/whatsapp-inbox/inbox.service.js";

const inboxRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  app.addHook("preHandler", async request => { if (request.method !== "GET" && request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada"); });
  const manualRequests = new Map<string, { at: number; count: number }>();
  app.post("/conversations/:id/uazapi/messages", { bodyLimit: 20000, logLevel: "silent" }, async (request, reply) => {
    const id = z.strictObject({ id: z.string().min(1).max(128) }).parse(request.params).id;
    const data = manual.manualSendSchema.parse(request.body);
    const now = Date.now(); const key = request.user!.id; const bucket = manualRequests.get(key);
    if (!bucket || now - bucket.at >= 60000) { if (manualRequests.size > 2000) manualRequests.clear(); manualRequests.set(key, { at: now, count: 1 }); }
    else if (++bucket.count > 30) throw httpError(429, "UAZAPI_MANUAL_RATE_LIMIT", "Aguarde um minuto antes de enviar novamente");
    return reply.status(201).send(await manual.send(request.orgId!, id, data, actorOf(request)));
  });
  app.get("/", async request => service.list(request.orgId!, schema.listSchema.parse(request.query)));
  app.get("/:id", async request => service.get(request.orgId!, schema.paramsSchema.parse(request.params).id));
  app.get("/:id/messages", async request => service.messages(request.orgId!, schema.paramsSchema.parse(request.params).id, schema.messagesSchema.parse(request.query)));
  app.delete("/:id", async request => service.remove(request.orgId!, schema.paramsSchema.parse(request.params).id, actorOf(request)));
  app.post("/:id/archive", { bodyLimit: 1024 }, async request => service.archive(request.orgId!, schema.paramsSchema.parse(request.params).id, z.strictObject({ archived: z.boolean() }).parse(request.body).archived, actorOf(request)));
  app.post("/:id/read", { bodyLimit: 1024 }, async request => { z.strictObject({}).parse(request.body); return service.read(request.orgId!, schema.paramsSchema.parse(request.params).id); });
  app.post("/conversations/:id/link-client", { bodyLimit: 1024 }, async request => service.linkOfficial(request.orgId!, z.strictObject({ id: z.string().min(1).max(128) }).parse(request.params).id, schema.linkSchema.parse(request.body).clientId, actorOf(request)));
};
export default inboxRoutes;
