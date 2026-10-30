/**
 * FLASH — normalized responses.
 *
 * Adapters translate a `FlashResponse` into their own server API. The framework
 * only produces three kinds of results, as defined by the specification:
 *
 *  1. redirect (navigation after a classic form submission);
 *  2. HTML, complete page or fragment;
 *  3. JSON, for explicit API endpoints.
 */

const HTML = 'text/html; charset=utf-8';

export class FlashResponse {
  /**
   * @param {{status?: number, headers?: Record<string, string|string[]>, body?: string|Buffer|null, type?: string|null}} [init]
   */
  constructor(init = {}) {
    this.status = init.status ?? 200;
    this.headers = { ...(init.headers ?? {}) };
    this.body = init.body ?? null;
    if (init.type !== null && !hasHeader(this.headers, 'content-type')) {
      this.headers['Content-Type'] = init.type ?? HTML;
    }
  }

  header(name, value) {
    this.headers[name] = value;
    return this;
  }

  /** Marks the response as a fragment for partial HTML updates. */
  fragment({ target = null, update = 'replace' } = {}) {
    this.headers['X-Flash-Update'] = update;
    if (target) this.headers['X-Flash-Target'] = target;
    return this;
  }
}

function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/** Ensures adapters only ever see a `FlashResponse`. */
export function toResponse(value) {
  if (value instanceof FlashResponse) return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return new FlashResponse({ body: value });
  if (Buffer.isBuffer(value)) {
    return new FlashResponse({ body: value, type: 'application/octet-stream' });
  }
  if (typeof value === 'object' && 'status' in value && 'headers' in value) {
    return new FlashResponse(value);
  }
  throw new TypeError('Controller returned an unsupported value; use ctx.render(), ctx.html(), ctx.json() or ctx.redirect()');
}

export function html(body, options = {}) {
  return new FlashResponse({ ...options, body, type: options.type ?? HTML });
}

export function text(body, options = {}) {
  return new FlashResponse({ ...options, body: String(body ?? ''), type: 'text/plain; charset=utf-8' });
}

export function json(data, options = {}) {
  return new FlashResponse({
    status: options.status ?? 200,
    headers: options.headers,
    body: JSON.stringify(data ?? null),
    type: 'application/json; charset=utf-8'
  });
}

/**
 * A redirect defaults to 303 (See Other) so that a POST followed by a redirect
 * always results in a GET, which keeps forms safe when reloaded.
 */
export function redirect(location, options = {}) {
  const status = typeof options === 'number' ? options : options.status ?? 303;
  const headers = { Location: location };
  return new FlashResponse({
    status,
    headers,
    body: '',
    type: null
  });
}

export function empty(status = 204) {
  return new FlashResponse({ status, body: null, type: null });
}
