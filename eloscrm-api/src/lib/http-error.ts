// `expose` distingue erro que nós escrevemos de erro que vazou: o errorHandler mascara qualquer 5xx
// como "Erro interno" para não expor detalhe do banco, mas as integrações externas precisam devolver
// 502/503/504 com código e mensagem próprios — é por eles que o front decide o que mostrar.
export type HttpError = Error & {
  statusCode: number;
  code: string;
  expose: true;
  details?: unknown;
};

export const httpError = (
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): HttpError => {
  const err = new Error(message) as HttpError;
  err.statusCode = statusCode;
  err.code = code;
  err.expose = true;
  if (details !== undefined) err.details = details;
  return err;
};

export const notFound = (message: string) => httpError(404, "NOT_FOUND", message);

export const forbidden = (message: string) => httpError(403, "FORBIDDEN", message);

export const conflict = (code: string, message: string) => httpError(409, code, message);
