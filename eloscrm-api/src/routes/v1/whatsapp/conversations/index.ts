import type { FastifyInstance } from "fastify";
import {
  listConversationsQuerySchema,
  listMessagesQuerySchema,
} from "../../../../modules/whatsapp/conversations.schema.js";
import * as service from "../../../../modules/whatsapp/conversations.service.js";
import { authGuard } from "../../../../plugins/auth-guard.js";
import { orgGuard } from "../../../../plugins/org-guard.js";

/**
 * Conversar é o trabalho do corretor: ler e responder valem para qualquer membro, diferente de
 * gerenciar a instância (§9 do spec), que é de gestor. Toda conversa é resolvida por
 * (id, organizationId) — nunca só por id.
 */
const conversationsRoutes = async (app: FastifyInstance) => {
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", orgGuard);

  app.get("/", async (request) => {
    const query = listConversationsQuerySchema.parse(request.query);
    return service.list(request.orgId!, query);
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return service.getById(request.orgId!, id);
  });

  app.get("/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const query = listMessagesQuerySchema.parse(request.query);
    return service.listMessages(request.orgId!, id, query);
  });

  app.post("/:id/read", async (request) => {
    const { id } = request.params as { id: string };
    return service.markRead(request.orgId!, id);
  });

  app.post("/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    return service.archive(request.orgId!, id, true);
  });

  app.post("/:id/unarchive", async (request) => {
    const { id } = request.params as { id: string };
    return service.archive(request.orgId!, id, false);
  });

  // a presigned expira em minutos; este endpoint existe para o front renovar sem recarregar a thread
  app.get("/messages/:messageId/media", async (request) => {
    const { messageId } = request.params as { messageId: string };
    return service.mediaUrl(request.orgId!, messageId);
  });
};

export default conversationsRoutes;
