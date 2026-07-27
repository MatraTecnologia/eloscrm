import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { ZodError } from "zod";

export const errorHandler = fp(async (app) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: { code: "VALIDATION", message: "Dados inválidos", details: error.issues },
      });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      // erro inesperado: loga o real para diagnóstico e não vaza detalhe interno ao cliente
      request.log.error(error);
      return reply.status(status).send({
        error: { code: "INTERNAL", message: "Erro interno" },
      });
    }
    return reply.status(status).send({
      error: { code: error.code ?? "INTERNAL", message: error.message },
    });
  });
});
