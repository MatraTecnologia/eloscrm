import type { FastifyRequest } from "fastify";
import { AuditSource } from "../generated/prisma/client.js";

/**
 * Quem fez, e de onde.
 *
 * `id`/`name` são o que as entidades com autoria consomem (comentário, anexo). Os campos de origem
 * existem para a auditoria e são opcionais de propósito: fora do ciclo de request — worker, cron,
 * webhook — não há IP nem user agent a registrar.
 */
export type Actor = {
  id: string;
  name: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  source?: AuditSource;
};

// request.user é populado pelo authGuard; chamar isto em rota sem o guard é erro de programação
export const actorOf = (request: FastifyRequest): Actor => ({
  id: request.user!.id,
  name: request.user!.name,
  email: request.user!.email,
  ip: request.ip,
  userAgent: request.headers["user-agent"],
  // agrupa os eventos nascidos da mesma chamada: é o que deixa a tela mostrar uma transferência em
  // lote como uma operação, e não como N alterações soltas
  requestId: request.id,
  source: AuditSource.USER,
});

/**
 * Autor do que ninguém clicou. O histórico exibe `actorName`, então "Automação" é o que o corretor
 * lê; o id vazio vira `null` no `recordAudit` e nunca é confundido com um usuário de verdade.
 */
export const AUTOMATION_ACTOR: Actor = {
  id: "",
  name: "Automação",
  source: AuditSource.AUTOMATION,
};

/** Evento entregue pela uazapi: não há usuário na ponta, e o que agiu foi o provedor. */
export const WEBHOOK_ACTOR: Actor = { id: "", name: "WhatsApp", source: AuditSource.WEBHOOK };

/** O que roda sem request: purga por retenção e afins. */
export const SYSTEM_ACTOR: Actor = { id: "", name: "Sistema", source: AuditSource.SYSTEM };
