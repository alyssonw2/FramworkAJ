/**
 * FLASH — router.
 *
 * A small, explicit route table. Patterns support static segments, named
 * parameters (`:id`) and a trailing wildcard (`*`).
 */

const PARAM_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function normalizePath(path) {
  if (typeof path !== 'string' || path === '') {
    throw new TypeError('Route path must be a non-empty string');
  }
  let normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function compilePattern(path) {
  const segments = normalizePath(path).split('/').slice(1);
  const keys = [];

  const source = segments
    .map((segment) => {
      if (segment === '*') {
        keys.push('*');
        return '(.*)';
      }
      if (segment.startsWith(':')) {
        const name = segment.slice(1);
        if (!PARAM_RE.test(name)) {
          throw new TypeError(`Invalid route parameter ":${name}" in "${path}"`);
        }
        keys.push(name);
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    keys,
    regex: new RegExp(`^/${source}/?$`)
  };
}

export class Router {
  constructor() {
    /** @type {Array<{method: string, path: string, keys: string[], regex: RegExp, handlers: Function[]}>} */
    this.routes = [];
  }

  /**
   * @param {string} method upper-case HTTP method or '*'
   * @param {string} path
   * @param {Function[]} handlers
   */
  add(method, path, handlers) {
    if (!handlers.length) throw new TypeError(`Route ${method} ${path} has no handler`);
    for (const handler of handlers) {
      if (typeof handler !== 'function') {
        throw new TypeError(`Route ${method} ${path} received a non-function handler`);
      }
    }
    const { keys, regex } = compilePattern(path);
    this.routes.push({ method: method.toUpperCase(), path: normalizePath(path), keys, regex, handlers });
    return this;
  }

  /**
   * @param {string} method
   * @param {string} pathname
   * @returns {{handlers: Function[], params: Record<string,string>, route: object} | {allowed: string[]} | null}
   */
  match(method, pathname) {
    const target = normalizePath(pathname || '/');
    const allowed = new Set();
    let matchedPath = false;

    for (const route of this.routes) {
      const result = route.regex.exec(target);
      if (!result) continue;

      matchedPath = true;

      if (route.method !== '*' && route.method !== method) {
        allowed.add(route.method);
        continue;
      }

      const params = Object.create(null);
      for (let i = 0; i < route.keys.length; i += 1) {
        const key = route.keys[i];
        const raw = result[i + 1] ?? '';
        params[key] = key === '*' ? raw : decodeURIComponent(raw);
      }

      return { handlers: route.handlers, params, route };
    }

    if (matchedPath && allowed.size) return { allowed: [...allowed] };
    return null;
  }

  /** Lists registered routes; used by docs, debugging and the `flash routes` CLI. */
  list() {
    return this.routes.map(({ method, path }) => ({ method, path }));
  }
}
