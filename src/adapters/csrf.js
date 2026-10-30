/**
 * FLASH — CSRF protection.
 *
 * Every cookie-authenticated mutation carries a token tied to the server-side
 * session. The token is exposed to templates as `csrfToken` and must be sent back
 * as the `_csrf` form field or the `X-CSRF-Token` header.
 *
 * `SameSite` cookies help, but they are not a substitute for this check.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../core/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * @param {{
 *   fieldName?: string,
 *   headerName?: string,
 *   sessionKey?: string,
 *   methods?: string[],
 *   message?: string
 * }} [options]
 */
export function csrf(options = {}) {
  const fieldName = options.fieldName ?? '_csrf';
  const headerName = (options.headerName ?? 'x-csrf-token').toLowerCase();
  const sessionKey = options.sessionKey ?? '__csrf';
  const methods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()));
  const message = options.message ?? 'Token CSRF inválido ou expirado. Recarregue a página e tente novamente.';

  const middleware = async (ctx) => {
    if (!ctx.session) {
      throw new HttpError(500, 'CSRF middleware requires the session middleware to run first');
    }

    let token = ctx.session[sessionKey];
    if (!token) {
      token = randomBytes(32).toString('base64url');
      ctx.session[sessionKey] = token;
    }

    ctx.csrfToken = token;
    ctx.locals.csrfToken = token;

    if (SAFE_METHODS.has(ctx.method) || !methods.has(ctx.method)) return undefined;

    const submitted = ctx.body?.[fieldName] ?? ctx.request.headers[headerName];

    if (!submitted || !safeEqual(submitted, token)) {
      throw new HttpError(403, message, { code: 'csrf_invalid' });
    }

    return undefined;
  };

  middleware.fieldName = fieldName;
  middleware.headerName = headerName;

  return middleware;
}
