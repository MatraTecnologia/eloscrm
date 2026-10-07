import * as z from "zod";
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { actorOf } from "../../../../lib/actor.js";
import { env } from "../../../../env.js";
import { forbidden, httpError } from "../../../../lib/http-error.js";
import * as schema from "../../../../modules/whatsapp-outbound/outbound.schema.js";
import * as service from "../../../../modules/whatsapp-outbound/outbound.service.js";
import { mediaTypes, storeMedia, type MediaMime } from "../../../../modules/whatsapp-outbound/media.service.js";

const outboundRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  const requests = new Map<string, { at: number; count: number }>();
  app.addHook("preHandler", async request => {
    if (request.method === "GET") return;
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada para enviar pelo WhatsApp");
    const now = Date.now();
    const key = request.user!.id;
    const bucket = requests.get(key);
    if (!bucket || now - bucket.at >= 60_000) { if (requests.size > 2000) requests.clear(); requests.set(key, { at: now, count: 1 }); }
    else if (++bucket.count > 60) throw httpError(429, "OFFICIAL_SEND_RATE_LIMIT", "Aguarde um minuto antes de enviar novamente");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && "expose" in error && error.expose === true && "statusCode" in error && typeof error.statusCode === "number" && "code" in error && typeof error.code === "string") return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error instanceof Error && error.name === "ZodError") return reply.status(422).send({ error: { code: "VALIDATION", message: "Dados inválidos para o envio oficial" } });
    if (error instanceof Error && "statusCode" in error && error.statusCode === 413) return reply.status(413).send({ error: { code: "OFFICIAL_MEDIA_LIMIT", message: "O arquivo excedeu o limite de upload" } });
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Não foi possível concluir a operação" } });
  });
  for (const mime of Object.keys(mediaTypes)) app.addContentTypeParser(mime, { parseAs: "buffer", bodyLimit: 16 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  const options = { bodyLimit: 32768, logLevel: "silent" as const };
  app.post("/connections/:connectionId/messages", options, async request => service.createSend(request.orgId!, schema.paramsSchema.parse(request.params).connectionId, request.body, actorOf(request)));
  app.get("/commands/:id", async request => service.getCommand(request.orgId!, schema.commandParamsSchema.parse(request.params).id));
  app.get("/connections/:connectionId/templates", async request => service.listTemplates(request.orgId!, schema.paramsSchema.parse(request.params).connectionId));
  app.post("/connections/:connectionId/templates/sync", options, async request => { z.strictObject({}).parse(request.body); return service.syncTemplates(request.orgId!, schema.paramsSchema.parse(request.params).connectionId); });
  app.post("/connections/:connectionId/uploads", { bodyLimit: 16 * 1024 * 1024, logLevel: "silent" }, async request => {
    const { filename } = z.strictObject({ filename: z.string().min(1).max(200) }).parse(request.query);
    const mime = request.headers["content-type"]?.split(";")[0]?.trim();
    if (!mime || !(mime in mediaTypes) || !Buffer.isBuffer(request.body)) throw httpError(422, "OFFICIAL_MEDIA_INVALID", "Tipo de arquivo não suportado");
    return storeMedia(request.orgId!, schema.paramsSchema.parse(request.params).connectionId, request.body, mime as MediaMime, filename);
  });
};
export default outboundRoutes;
