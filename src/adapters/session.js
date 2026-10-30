/**
 * FLASH — cookie sessions.
 *
 * Session data lives on the server; the cookie only carries a signed random id.
 * Cookies are `HttpOnly` and `SameSite=Lax` by default and become `Secure` when
 * the configured `secure` option is true (enable it behind HTTPS).
 *
 * The store interface is intentionally tiny so a Redis/Postgres store can be
 * dropped in without touching the framework:
 *
 *   get(id) -> data|null, set(id, data, ttlSeconds), destroy(id)
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const RESERVED = new Set(['id', 'data', 'regenerate', 'destroy', 'touch', 'isNew', 'dirty', 'destroyed']);

export class MemoryStore {
  constructor({ defaultTtl = 86400 } = {}) {
    this.defaultTtl = defaultTtl;
    this.map = new Map();
    this.timer = setInterval(() => this.cleanup(), Math.min(this.defaultTtl * 1000, 300_000));
    this.timer.unref?.();
  }

  async get(id) {
    const entry = this.map.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(id);
      return null;
    }
    return entry.data;
  }

  async set(id, data, ttlSeconds = this.defaultTtl) {
    this.map.set(id, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async destroy(id) {
    this.map.delete(id);
  }

  async touch(id, ttlSeconds = this.defaultTtl) {
    const entry = this.map.get(id);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(id);
    }
  }

  close() {
    clearInterval(this.timer);
  }
}

class SessionState {
  constructor(store, id, data, ttl) {
    this.store = store;
    this.id = id;
    this.data = data;
    this.ttl = ttl;
    this.isNew = false;
    this.dirty = false;
    this.destroyed = false;
  }

  regenerate() {
    this.id = randomBytes(32).toString('hex');
    this.data = Object.create(null);
    this.isNew = true;
    this.dirty = true;
    this.destroyed = false;
    return this;
  }

  destroy() {
    this.destroyed = true;
    this.dirty = true;
    this.data = Object.create(null);
  }

  touch() {
    this.dirty = true;
  }
}

function sessionProxy(state) {
  return new Proxy(state, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || RESERVED.has(property)) {
        return Reflect.get(target, property, receiver);
      }
      if (property in target && !(property in target.data)) {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return target.data[property];
    },
    set(target, property, value) {
      if (typeof property === 'symbol' || RESERVED.has(property)) {
        return Reflect.set(target, property, value);
      }
      target.data[property] = value;
      target.dirty = true;
      return true;
    },
    deleteProperty(target, property) {
      if (typeof property === 'symbol' || RESERVED.has(property)) {
        return Reflect.deleteProperty(target, property);
      }
      delete target.data[property];
      target.dirty = true;
      return true;
    },
    has(target, property) {
      return RESERVED.has(property) || Reflect.has(target, property) || property in target.data;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target.data);
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === 'symbol' || RESERVED.has(property)) return undefined;
      if (!(property in target.data)) return undefined;
      return { value: target.data[property], enumerable: true, configurable: true, writable: true };
    }
  });
}

function sign(id, secret) {
  return createHmac('sha256', secret).update(id).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * @param {{
 *   store?: MemoryStore,
 *   secret?: string,
 *   cookieName?: string,
 *   maxAge?: number,
 *   secure?: boolean,
 *   sameSite?: 'Lax'|'Strict'|'None',
 *   path?: string,
 *   rolling?: boolean,
 *   logger?: {warn: Function}
 * }} [options]
 */
export function session(options = {}) {
  const store = options.store ?? new MemoryStore();
  const secret = options.secret ?? randomBytes(32).toString('hex');
  const cookieName = options.cookieName ?? 'flash.sid';
  const maxAge = options.maxAge ?? 86400;
  const secure = options.secure ?? false;
  const sameSite = options.sameSite ?? 'Lax';
  const cookiePath = options.path ?? '/';
  const rolling = options.rolling ?? true;

  if (!options.secret && options.logger?.warn) {
    options.logger.warn(
      '[flash] session secret not configured; using a random secret. Sessions will be invalidated on restart.'
    );
  }

  const serialize = (id) =>
    [
      `${cookieName}=${id}.${sign(id, secret)}`,
      `Path=${cookiePath}`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      `SameSite=${sameSite}`,
      secure ? 'Secure' : null
    ]
      .filter(Boolean)
      .join('; ');

  const clearCookie = () =>
    [`${cookieName}=`, `Path=${cookiePath}`, 'Max-Age=0', 'HttpOnly', `SameSite=${sameSite}`, secure ? 'Secure' : null]
      .filter(Boolean)
      .join('; ');

  const middleware = async (ctx) => {
    const raw = ctx.request.cookies[cookieName];
    let state = null;

    if (raw) {
      const separator = raw.lastIndexOf('.');
      if (separator > 0) {
        const id = raw.slice(0, separator);
        const signature = raw.slice(separator + 1);
        if (safeEqual(signature, sign(id, secret))) {
          const data = await store.get(id);
          if (data) {
            state = new SessionState(store, id, data, maxAge);
            if (rolling) state.dirty = true;
          }
        }
      }
    }

    if (!state) {
      state = new SessionState(store, randomBytes(32).toString('hex'), Object.create(null), maxAge);
      state.isNew = true;
      state.dirty = true;
    }

    const proxy = sessionProxy(state);
    ctx.session = proxy;
    ctx.request.session = proxy;

    ctx.defer(async (response) => {
      if (state.destroyed) {
        await store.destroy(state.id);
        appendSetCookie(response, clearCookie());
        return;
      }

      if (!state.dirty) return;

      await store.set(state.id, state.data, maxAge);
      appendSetCookie(response, serialize(state.id));
    });

    return undefined;
  };

  middleware.store = store;
  middleware.cookieName = cookieName;
  return middleware;
}

function appendSetCookie(response, cookie) {
  const current = response.headers['Set-Cookie'];
  if (!current) {
    response.headers['Set-Cookie'] = cookie;
    return;
  }
  response.headers['Set-Cookie'] = Array.isArray(current) ? [...current, cookie] : [current, cookie];
}
