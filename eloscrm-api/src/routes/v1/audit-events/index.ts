import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";
import { listAuditQuerySchema } from "../../../modules/audit/audit.schema.js";
import * as service from "../../../modules/audit/audit.service.js";

/**
 * Duas leituras na mesma rota: com `entityId`, é o histórico de um item e vale para qualquer membro;
 * sem ele, é a busca da imobiliária e exige gestor. Quem separa é o service — guard de papel no
 * arquivo fecharia a aba Histórico do corretor junto.
 */
const auditEventsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const filters = listAuditQuerySchema.parse(request.query);
    return service.list(request.orgId!, filters, actorOf(request));
  });

  // antes de qualquer rota com parâmetro: registrada depois, uma curinga capturaria "actors"
  app.get("/actors", async (request) => service.actors(request.orgId!, actorOf(request)));

  app.get("/export", async (request, reply) => {
    const filters = listAuditQuerySchema.parse(request.query);
    const { csv } = await service.exportCsv(request.orgId!, filters, actorOf(request));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="auditoria.csv"')
      .send(csv);
  });
};

export default auditEventsRoutes;
