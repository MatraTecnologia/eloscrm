import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import {
  connectMetaSchema,
  listMetaLeadsQuerySchema,
  updateMetaFormSchema,
  updateMetaSettingsSchema,
} from "../../../modules/meta/meta.schema.js";
import * as service from "../../../modules/meta/meta.service.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";

const metaRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  // Como no WhatsApp: a integração é resolvida por request.orgId e o @unique garante uma por
  // imobiliária. O único :id é o do formulário, e o service o procura dentro da integração da org.
  app.get("/integration", async (request) => service.get(request.orgId!));

  app.post("/integration", async (request, reply) => {
    const data = connectMetaSchema.parse(request.body);
    const integration = await service.connect(request.orgId!, data, actorOf(request));
    return reply.status(201).send(integration);
  });

  app.patch("/integration", async (request) => {
    const data = updateMetaSettingsSchema.parse(request.body);
    return service.updateSettings(request.orgId!, data, actorOf(request));
  });

  app.delete("/integration", async (request, reply) => {
    await service.disconnect(request.orgId!, actorOf(request));
    return reply.status(204).send();
  });

  app.post("/integration/sync-forms", async (request) => service.syncForms(request.orgId!, actorOf(request)));

  app.post("/integration/sync", async (request) => service.syncNow(request.orgId!, actorOf(request)));

  app.patch<{ Params: { id: string } }>("/integration/forms/:id", async (request) => {
    const data = updateMetaFormSchema.parse(request.body);
    return service.updateForm(request.orgId!, request.params.id, data, actorOf(request));
  });

  app.get("/integration/leads", async (request) => {
    const query = listMetaLeadsQuerySchema.parse(request.query);
    return service.listLeads(request.orgId!, query);
  });
};

export default metaRoutes;
