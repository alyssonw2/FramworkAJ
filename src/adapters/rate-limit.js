/**
 * FLASH — in-memory rate limiting.
 *
 * Good enough for a single process (login, password reset, sensitive actions).
 * For multi-instance deployments use a shared store (Redis) behind the same
 * interface. Rate limiting complements — never replaces — server-side
 * authorization and validation.
 */

import { HttpError } from '../core/errors.js';

/**
 * @param {{
 *   windowMs?: number,
 *   max?: number,
 *   key?: (ctx: import('../core/context.js').Context) => string,
 *   message?: string,
 *   skip?: (ctx: import('../core/context.js').Context) => boolean
 * }} [options]
 */
export function rateLimit(options = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const keyOf = options.key ?? ((ctx) => ctx.ip ?? 'unknown');
  const message = options.message ?? 'Muitas requisições. Tente novamente em instantes.';
  const skip = options.skip ?? (() => false);

  const buckets = new Map();

  const middleware = async (ctx) => {
    if (skip(ctx)) return undefined;

    const key = keyOf(ctx);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new HttpError(429, message, { headers: { 'Retry-After': String(retryAfter) } });
    }

    return undefined;
  };

  middleware.reset = (key) => (key === undefined ? buckets.clear() : buckets.delete(key));
  middleware.buckets = buckets;

  return middleware;
}
