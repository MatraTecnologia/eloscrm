import type { FastifyRequest } from "fastify";

export type Actor = { id: string; name: string };

// request.user é populado pelo authGuard; chamar isto em rota sem o guard é erro de programação
export const actorOf = (request: FastifyRequest): Actor => ({
  id: request.user!.id,
  name: request.user!.name,
});

/**
 * Autor do que ninguém clicou. O histórico exibe `actorName`, então "Automação" é o que o corretor
 * lê; o id vazio vira `null` no `recordAudit` e nunca é confundido com um usuário de verdade.
 */
export const AUTOMATION_ACTOR: Actor = { id: "", name: "Automação" };
