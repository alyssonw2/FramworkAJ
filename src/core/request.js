/**
 * FLASH — request normalization.
 *
 * Adapters (Express, node:http, tests) only need to provide method, path,
 * headers and a parsed body. Everything the framework relies on lives in this
 * normalized object, which keeps `flash.handle()` adapter-independent.
 */

import { randomUUID } from 'node:crypto';

export function parseQueryString(search) {
  const query = Object.create(null);
  if (!search) return query;
  const source = search.startsWith('?') ? search.slice(1) : search;
  if (source === '') return query;

  for (const [key, value] of new URLSearchParams(source)) {
    if (Object.hasOwn(query, key)) {
      const current = query[key];
      query[key] = Array.isArray(current) ? [...current, value] : [current, value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

export function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header) return cookies;

  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function safeDecodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * @param {{
 *   method?: string,
 *   path?: string,
 *   query?: Record<string, unknown> | URLSearchParams,
 *   headers?: Record<string, unknown>,
 *   body?: Record<string, unknown>,
 *   rawBody?: string,
 *   ip?: string,
 *   protocol?: string,
 *   id?: string
 * }} input
 */
export function normalizeRequest(input = {}) {
  const method = String(input.method ?? 'GET').toUpperCase();

  let pathname = String(input.path ?? '/');
  let search = '';

  if (pathname.includes('?')) {
    const index = pathname.indexOf('?');
    search = pathname.slice(index);
    pathname = pathname.slice(0, index);
  }

  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  const headers = Object.create(null);
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value === undefined || value === null) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  let query;
  if (input.query instanceof URLSearchParams) {
    query = Object.fromEntries(input.query);
  } else if (input.query && typeof input.query === 'object') {
    query = Object.assign(Object.create(null), input.query);
  } else {
    query = parseQueryString(search);
  }

  return {
    method,
    path: safeDecodePath(pathname),
    rawPath: pathname,
    url: pathname + search,
    query,
    headers,
    cookies: parseCookies(headers.cookie),
    body: input.body ?? Object.create(null),
    rawBody: input.rawBody ?? '',
    ip: input.ip ?? headers['x-forwarded-for'] ?? null,
    protocol: input.protocol ?? headers['x-forwarded-proto'] ?? 'http',
    id: input.id ?? randomUUID()
  };
}
