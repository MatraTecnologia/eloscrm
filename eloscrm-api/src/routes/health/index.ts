import type { FastifyInstance } from "fastify";
import { identityAuditFailures } from "../../modules/audit/identity.audit.js";
import { organizationPurgeFailures } from "../../modules/audit/organization-purge.service.js";

const healthRoutes = async (app: FastifyInstance) => {
  app.get("/", async () => ({
    status: "ok",
    // Os dois caminhos que engolem a própria falha de propósito (para não trancar login nem exclusão
    // de imobiliária) precisam de um número visível: sem isto, uma trilha sistematicamente quebrada
    // é indistinguível de um dia sem logins, e objeto órfão no R2 não avisa ninguém.
    auditFailures: identityAuditFailures.count,
    orgPurgeFailures: organizationPurgeFailures.count,
  }));
};

export default healthRoutes;
