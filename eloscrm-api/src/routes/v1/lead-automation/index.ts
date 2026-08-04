import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../lib/actor.js";
import { updateLeadAutomationSchema } from "../../../modules/lead-automation/lead-automation.schema.js";
import * as service from "../../../modules/lead-automation/lead-automation.service.js";
import { authGuard } from "../../../plugins/auth-guard.js";
import { orgGuard } from "../../../plugins/org-guard.js";

const leadAutomationRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  // Sem :id: a configuração é resolvida por request.orgId e o @unique garante uma por imobiliária.
  // Leitura é liberada a qualquer membro — o corretor tem o direito de saber como os leads são
  // distribuídos; alterar é que exige gestor, e a guarda fica no service.
  app.get("/", async (request) => service.get(request.orgId!));

  app.put("/", async (request) => {
    const data = updateLeadAutomationSchema.parse(request.body);
    return service.update(request.orgId!, data, actorOf(request));
  });
};

export default leadAutomationRoutes;
