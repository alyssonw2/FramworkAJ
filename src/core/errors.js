/**
 * FLASH — HTTP errors.
 *
 * Controllers throw these to produce a predictable status code. Anything that is
 * not an `HttpError` is treated as a server fault and never exposes its message
 * to the browser in production.
 */

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {{expose?: boolean, code?: string, headers?: Record<string,string>, details?: unknown}} [options]
   */
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = options.expose ?? status < 500;
    this.code = options.code ?? null;
    this.headers = options.headers ?? {};
    this.details = options.details;
  }

  toJSON() {
    return {
      status: this.status,
      message: this.expose ? this.message : 'Internal Server Error',
      code: this.code
    };
  }
}

export const badRequest = (message = 'Requisição inválida', options) =>
  new HttpError(400, message, options);

export const unauthorized = (message = 'Autenticação necessária', options) =>
  new HttpError(401, message, options);

export const forbidden = (message = 'Acesso negado', options) =>
  new HttpError(403, message, options);

export const notFound = (message = 'Não encontrado', options) =>
  new HttpError(404, message, options);

export const methodNotAllowed = (message = 'Método não permitido', allowed = []) =>
  new HttpError(405, message, { headers: allowed.length ? { Allow: allowed.join(', ') } : {} });

export const conflict = (message = 'Conflito de estado', options) =>
  new HttpError(409, message, options);

export const unprocessable = (message = 'Dados inválidos', options) =>
  new HttpError(422, message, options);

export const tooManyRequests = (message = 'Muitas requisições', retryAfter = 60) =>
  new HttpError(429, message, { headers: { 'Retry-After': String(retryAfter) } });

/**
 * A validation failure that knows which fields are wrong.
 * The template layer receives `errors` as a plain object.
 */
export class ValidationError extends HttpError {
  constructor(errors, message = 'Dados inválidos') {
    super(422, message, { expose: true, code: 'validation_error' });
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
