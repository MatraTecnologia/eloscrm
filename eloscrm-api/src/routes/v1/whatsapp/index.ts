import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import {
  connectInstanceSchema,
  createInstanceSchema,
  listLogsQuerySchema,
  renameInstanceSchema,
} from "../../../modules/whatsapp/whatsapp.schema.js";
import * as service from "../../../modules/whatsapp/whatsapp.service.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";

const whatsappRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  // Não há :id em nenhuma rota: a instância é resolvida por request.orgId, e o @unique em
  // organizationId garante que existe no máximo uma. Não sobra id na URL para adulterar.
  app.get("/instance", async (request) => service.get(request.orgId!));

  app.post("/instance", async (request, reply) => {
    const data = createInstanceSchema.parse(request.body ?? {});
    const instance = await service.create(request.orgId!, data, actorOf(request));
    return reply.status(201).send(instance);
  });

  app.patch("/instance", async (request) => {
    const data = renameInstanceSchema.parse(request.body);
    return service.rename(request.orgId!, data, actorOf(request));
  });

  app.delete("/instance", async (request, reply) => {
    await service.remove(request.orgId!, actorOf(request));
    return reply.status(204).send();
  });

  app.post("/instance/connect", async (request) => {
    const data = connectInstanceSchema.parse(request.body ?? {});
    return service.connect(request.orgId!, data, actorOf(request));
  });

  app.post("/instance/disconnect", async (request) => service.disconnect(request.orgId!, actorOf(request)));

  app.post("/instance/reset", async (request) => service.reset(request.orgId!, actorOf(request)));

  app.post("/instance/sync", async (request) => service.sync(request.orgId!, actorOf(request)));

  app.get("/instance/wa-limits", async (request) => service.waLimits(request.orgId!, actorOf(request)));

  app.get("/instance/webhook", async (request) => service.getWebhook(request.orgId!, actorOf(request)));

  app.post("/instance/webhook/reconcile", async (request) =>
    service.reconcileWebhook(request.orgId!, actorOf(request)),
  );

  app.get("/instance/webhook/errors", async (request) => service.webhookErrors(request.orgId!, actorOf(request)));

  app.get("/instance/logs", async (request) => {
    const query = listLogsQuerySchema.parse(request.query);
    return service.logs(request.orgId!, query, actorOf(request));
  });
};

export default whatsappRoutes;
