import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import {
  createBroadcastSchema,
  listBroadcastsQuerySchema,
  previewBroadcastSchema,
} from "../../../modules/broadcasts/broadcasts.schema.js";
import * as service from "../../../modules/broadcasts/broadcasts.service.js";
import * as z from "zod";
import { env } from "../../../env.js";
import { forbidden, httpError } from "../../../lib/http-error.js";
import { importFileSchema } from "../../../modules/campaign-imports/imports.schema.js";
import { parseImport } from "../../../modules/campaign-imports/imports.service.js";

const broadcastsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  const requests = new Map<string, { at: number; count: number }>();
  app.addHook("preHandler", async request => {
    if (request.method === "GET") return;
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada");
    const now = Date.now(); const key = request.user!.id; const bucket = requests.get(key);
    if (!bucket || now - bucket.at >= 60000) { if (requests.size > 2000) requests.clear(); requests.set(key, { at: now, count: 1 }); }
    else if (++bucket.count > 30) throw httpError(429, "BROADCAST_RATE_LIMIT", "Aguarde um minuto antes de tentar novamente");
  });
  const options = { bodyLimit: 131072, logLevel: "silent" as const };
  const params = z.strictObject({ id: z.string().min(1).max(128) });

  app.get("/", async (request) => {
    const query = listBroadcastsQuerySchema.parse(request.query);
    return service.list(request.orgId!, query);
  });
  app.post("/imports/preview", { bodyLimit: 1450000, logLevel: "silent" }, async request => {
    const input = importFileSchema.parse(request.body);
    return parseImport(input.filename, Buffer.from(input.content, "base64"));
  });

  // POST e não GET: as condições são um objeto aninhado, que não cabe bem em query string
  app.post("/preview", options, async (request) => {
    const data = previewBroadcastSchema.parse(request.body);
    return service.preview(request.orgId!, data);
  });

  app.post("/", options, async (request, reply) => {
    const data = createBroadcastSchema.parse(request.body);
    const broadcast = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(broadcast);
  });

  app.get("/:id", async (request) => {
    const { id } = params.parse(request.params);
    return service.getById(request.orgId!, id);
  });

  app.post("/:id/cancel", options, async (request) => {
    const { id } = params.parse(request.params);
    z.strictObject({}).parse(request.body ?? {});
    return service.cancel(request.orgId!, id, actorOf(request));
  });
  for (const action of ["pause", "resume"] as const) app.post(`/:id/${action}`, options, async request => {
    z.strictObject({}).parse(request.body ?? {});
    return service.changeState(request.orgId!, params.parse(request.params).id, action === "pause" ? "PAUSED" : "RUNNING", actorOf(request));
  });
};

export default broadcastsRoutes;
