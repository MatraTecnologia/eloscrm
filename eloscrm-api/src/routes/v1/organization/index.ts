import type { FastifyInstance } from "fastify";
import * as z from "zod";
import { actorOf } from "../../../lib/actor.js";
import * as service from "../../../modules/organization/organization.service.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";

const deleteOrganizationSchema = z.object({
  // o slug que o dono digitou na tela; conferido contra o real no service
  confirm: z.string().min(1),
});

/**
 * Rotas da própria imobiliária. Sempre a **ativa** da sessão — não há `:id` de propósito, pelo mesmo
 * motivo das rotas de WhatsApp: sem id na URL não existe id para adulterar.
 */
const organizationRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/deletion-preview", async (request) =>
    service.deletionPreview(request.orgId!, actorOf(request)),
  );

  app.delete("/", async (request, reply) => {
    const { confirm } = deleteOrganizationSchema.parse(request.body);
    await service.remove(request.orgId!, confirm, actorOf(request));
    return reply.status(204).send();
  });
};

export default organizationRoutes;
