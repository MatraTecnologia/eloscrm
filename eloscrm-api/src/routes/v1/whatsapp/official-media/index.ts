import * as z from "zod";
import type { FastifyInstance } from "fastify";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";
import { env } from "../../../../env.js";
import { forbidden } from "../../../../lib/http-error.js";
import { officialMediaUrl, retryOfficialMedia } from "../../../../modules/whatsapp-official/media.service.js";

const paramsSchema = z.strictObject({ id: z.string().min(1).max(128) });
const officialMediaRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);
  app.get("/:id", { logLevel: "silent" }, request => {
    const query = z.strictObject({ download: z.literal("1").optional() }).parse(request.query);
    return officialMediaUrl(request.orgId!, paramsSchema.parse(request.params).id, !!query.download);
  });
  app.post("/:id/retry", { bodyLimit: 1024, logLevel: "silent" }, request => {
    if (request.headers.origin !== new URL(env.WEB_ORIGIN).origin) throw forbidden("Origem não autorizada");
    z.strictObject({}).parse(request.body);
    z.strictObject({}).parse(request.query);
    return retryOfficialMedia(request.orgId!, paramsSchema.parse(request.params).id);
  });
};
export default officialMediaRoutes;
