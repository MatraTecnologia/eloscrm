export type HttpError = Error & { statusCode: number; code: string };

export const httpError = (statusCode: number, code: string, message: string): HttpError => {
  const err = new Error(message) as HttpError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
};

export const notFound = (message: string) => httpError(404, "NOT_FOUND", message);
