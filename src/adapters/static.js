/**
 * FLASH — static file serving.
 *
 * The framework serves two kinds of assets without extra dependencies:
 *  - the browser runtime (`/__flash/...`), so pages work out of the box;
 *  - the project's public directory (optional).
 *
 * Only GET/HEAD are handled, directory traversal is rejected and responses
 * carry validators (`ETag`) so repeat visits stay cheap.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlashResponse } from '../core/response.js';

export const DEFAULT_RUNTIME_PREFIX = '/__flash';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNTIME_DIR = path.resolve(HERE, '..', 'client');
export const DEFAULT_SHARED_DIR = path.resolve(HERE, '..', 'shared');
export const DEFAULT_UI_DIR = path.resolve(HERE, '..', 'ui');
export const DEFAULT_DEV_DIR = path.resolve(HERE, '..', 'dev');

export const MIME_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json'
};

function normalizePrefix(prefix) {
  if (!prefix || prefix === '/') return '/';
  const withSlash = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

/**
 * @param {{
 *   publicDir?: string|null,
 *   publicPrefix?: string,
 *   runtimeDir?: string|null,
 *   runtimePrefix?: string,
 *   dev?: boolean,
 *   immutable?: boolean,
 *   index?: boolean
 * }} options
 */
export function createStaticRoutes(options = {}) {
  const routes = [];

  if (options.runtimeDir !== null) {
    const runtimeDir = path.resolve(options.runtimeDir ?? DEFAULT_RUNTIME_DIR);
    const prefix = normalizePrefix(options.runtimePrefix ?? DEFAULT_RUNTIME_PREFIX);
    const maxAge = options.dev ? 0 : 3600;

    // Longest prefix first: `/__flash/client`, `/__flash/shared` and `/__flash/ui`
    // are siblings of each other and must win the match over `/__flash`.
    routes.push({
      prefix: `${prefix}/client`,
      dir: runtimeDir,
      maxAge,
      immutable: false
    });
    routes.push({
      prefix: `${prefix}/shared`,
      dir: path.resolve(options.sharedDir ?? DEFAULT_SHARED_DIR),
      maxAge,
      immutable: false
    });
    routes.push({
      prefix: `${prefix}/ui`,
      dir: path.resolve(options.uiDir ?? DEFAULT_UI_DIR),
      maxAge,
      immutable: false
    });

    // Devtools panel — never served outside development.
    if (options.dev) {
      routes.push({
        prefix: `${prefix}/dev`,
        dir: path.resolve(options.devDir ?? DEFAULT_DEV_DIR),
        maxAge: 0,
        immutable: false
      });
    }
  }

  if (options.publicDir) {
    routes.push({
      prefix: normalizePrefix(options.publicPrefix ?? '/assets'),
      dir: path.resolve(options.publicDir),
      maxAge: options.dev ? 0 : options.immutable ? 31536000 : 3600,
      immutable: Boolean(options.immutable)
    });
  }

  routes.sort((a, b) => b.prefix.length - a.prefix.length);
  return routes;
}

function isSafeRelativePath(relative) {
  if (relative === '' || relative.includes('\0')) return false;
  const segments = relative.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}

async function resolveFile(route, pathname) {
  if (route.prefix !== '/' && pathname !== route.prefix && !pathname.startsWith(`${route.prefix}/`)) {
    return null;
  }

  let relative = route.prefix === '/' ? pathname.slice(1) : pathname.slice(route.prefix.length + 1);
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }

  if (!isSafeRelativePath(decoded)) return null;

  const file = path.resolve(route.dir, decoded);
  if (file !== route.dir && !file.startsWith(route.dir + path.sep)) return null;

  try {
    const stats = await fs.stat(file);
    if (stats.isDirectory()) return null;
    return { file, stats };
  } catch {
    return null;
  }
}

/**
 * Tries to serve a static asset. Returns `null` when the request should fall
 * through to the router.
 *
 * @param {ReturnType<typeof createStaticRoutes>} routes
 * @param {{pathname: string, method: string, headers: Record<string,string>}} request
 * @returns {Promise<FlashResponse|null>}
 */
export async function serveStaticFile(routes, request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!routes.length) return null;

  for (const route of routes) {
    const resolved = await resolveFile(route, request.pathname);
    if (!resolved) continue;

    const { file, stats } = resolved;
    const etag = `W/"${stats.size.toString(36)}-${Math.floor(stats.mtimeMs).toString(36)}"`;
    const cacheControl = route.maxAge > 0
      ? `public, max-age=${route.maxAge}${route.immutable ? ', immutable' : ''}`
      : 'no-cache';

    const headers = {
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString(),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff'
    };

    if (request.headers['if-none-match'] === etag) {
      return new FlashResponse({ status: 304, headers, body: null, type: null });
    }

    const extension = path.extname(file).toLowerCase();
    const type = MIME_TYPES[extension] ?? 'application/octet-stream';
    const body = request.method === 'HEAD' ? null : await fs.readFile(file);

    return new FlashResponse({ status: 200, headers, body, type });
  }

  return null;
}
