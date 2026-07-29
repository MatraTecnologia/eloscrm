import type { FastifyRequest } from "fastify";

export type Actor = { id: string; name: string };

// request.user é populado pelo authGuard; chamar isto em rota sem o guard é erro de programação
export const actorOf = (request: FastifyRequest): Actor => ({
  id: request.user!.id,
  name: request.user!.name,
});
