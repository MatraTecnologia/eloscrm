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
    // httpError() marca expose: a mensagem foi escrita por nós, em pt-BR, para o usuário final.
    // Sem a flag, um 5xx é erro que vazou e a mensagem pode conter detalhe interno.
    const expose = (error as { expose?: boolean }).expose === true;
    if (status >= 500) {
      // loga o real para diagnóstico mesmo quando a resposta é exposta
      request.log.error(error);
      if (!expose) {
        return reply.status(status).send({
          error: { code: "INTERNAL", message: "Erro interno" },
        });
      }
    }
    const details = (error as { details?: unknown }).details;
    return reply.status(status).send({
      error: {
        code: error.code ?? "INTERNAL",
        message: error.message,
        ...(details === undefined ? {} : { details }),
      },
    });
  });
});
