import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../../lib/actor.js";
import {
  createClientFromConversationSchema,
  linkClientSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
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

  app.post("/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = sendMessageSchema.parse(request.body);
    const message = await service.sendText(request.orgId!, id, data, actorOf(request));
    return reply.status(201).send(message);
  });

  app.get("/:id/candidates", async (request) => {
    const { id } = request.params as { id: string };
    return service.candidates(request.orgId!, id);
  });

  app.post("/:id/create-client", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = createClientFromConversationSchema.parse(request.body);
    const client = await service.createClientFrom(request.orgId!, id, data, actorOf(request));
    return reply.status(201).send(client);
  });

  app.post("/:id/link-client", async (request) => {
    const { id } = request.params as { id: string };
    const { clientId } = linkClientSchema.parse(request.body);
    return service.linkClient(request.orgId!, id, clientId);
  });

  app.post("/:id/unlink-client", async (request) => {
    const { id } = request.params as { id: string };
    return service.unlinkClient(request.orgId!, id);
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
