import type { FastifyInstance } from "fastify";
import { actorOf } from "../../../../lib/actor.js";
import {
  createClientFromConversationSchema,
  linkClientSchema,
  listConversationsQuerySchema,
  favoriteSchema,
  listMessagesQuerySchema,
  mediaUploadUrlSchema,
  pinSchema,
  reactSchema,
  sendMediaSchema,
  sendMessageSchema,
} from "../../../../modules/whatsapp/conversations.schema.js";
import * as service from "../../../../modules/whatsapp/conversations.service.js";
import * as actions from "../../../../modules/whatsapp/message-actions.service.js";
import * as reactions from "../../../../modules/whatsapp/reactions.service.js";
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

  // antes de `/:id`: registrada depois, a rota curinga capturaria "counts" como id de conversa
  app.get("/counts", async (request) => service.counts(request.orgId!));

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

  // O arquivo sobe direto do navegador para o R2, como nos anexos: o corpo da API não carrega
  // vídeo nenhum, e o envio recebe só a chave — conferida contra o prefixo desta conversa.
  app.post("/:id/media/upload-url", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = mediaUploadUrlSchema.parse(request.body);
    const result = await service.createMediaUploadUrl(request.orgId!, id, data);
    return reply.status(201).send(result);
  });

  app.post("/:id/messages/media", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = sendMediaSchema.parse(request.body);
    const message = await service.sendMedia(request.orgId!, id, data, actorOf(request));
    return reply.status(201).send(message);
  });

  app.post("/:id/messages/:messageId/reaction", async (request) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    const { emoji } = reactSchema.parse(request.body);
    return reactions.react(request.orgId!, id, messageId, emoji);
  });

  app.get("/:id/pinned", async (request) => {
    const { id } = request.params as { id: string };
    return service.pinned(request.orgId!, id);
  });

  app.post("/:id/messages/:messageId/pin", async (request) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    const data = pinSchema.parse(request.body);
    return actions.pin(request.orgId!, id, messageId, data);
  });

  app.post("/:id/messages/:messageId/favorite", async (request) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    const { favorite } = favoriteSchema.parse(request.body);
    return actions.favorite(request.orgId!, id, messageId, favorite, actorOf(request));
  });

  app.delete("/:id/messages/:messageId", async (request) => {
    const { id, messageId } = request.params as { id: string; messageId: string };
    return actions.remove(request.orgId!, id, messageId, actorOf(request));
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
    return service.linkClient(request.orgId!, id, clientId, actorOf(request));
  });

  app.post("/:id/unlink-client", async (request) => {
    const { id } = request.params as { id: string };
    return service.unlinkClient(request.orgId!, id, actorOf(request));
  });

  app.post("/:id/read", async (request) => {
    const { id } = request.params as { id: string };
    return service.markRead(request.orgId!, id);
  });

  app.post("/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    return service.archive(request.orgId!, id, true, actorOf(request));
  });

  app.post("/:id/unarchive", async (request) => {
    const { id } = request.params as { id: string };
    return service.archive(request.orgId!, id, false, actorOf(request));
  });

  // exclusão local: apaga o histórico daqui, não do WhatsApp do lead
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(request.orgId!, id, actorOf(request));
    return reply.status(204).send();
  });

  // a presigned expira em minutos; este endpoint existe para o front renovar sem recarregar a thread
  // `?download=1` devolve a URL como anexo; sem ele, a URL serve para exibir na bolha
  app.get("/messages/:messageId/media", async (request) => {
    const { messageId } = request.params as { messageId: string };
    const { download } = request.query as { download?: string };
    return service.mediaUrl(request.orgId!, messageId, download === "1" || download === "true");
  });
};

export default conversationsRoutes;
