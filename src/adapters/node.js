/**
 * FLASH — minimal node:http adapter.
 *
 * Useful when you do not want Express in the dependency graph (or in tests).
 *
 *   import { listen } from 'flash/node';
 *   const { url } = await listen(flash, { port: 3000 });
 */

import http from 'node:http';
import { FlashResponse } from '../core/response.js';

const DEFAULT_LIMIT = 1_000_000;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('Corpo da requisição excede o limite permitido');
        error.status = 413;
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(buffer, contentType) {
  if (!buffer || buffer.length === 0) return Object.create(null);
  const text = buffer.toString('utf8');
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();

  if (type === 'application/x-www-form-urlencoded') {
    const body = Object.create(null);
    for (const [key, value] of new URLSearchParams(text)) {
      if (Object.hasOwn(body, key)) {
        const current = body[key];
        body[key] = Array.isArray(current) ? [...current, value] : [current, value];
      } else {
        body[key] = value;
      }
    }
    return body;
  }

  if (type === 'application/json') {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : Object.create(null);
    } catch {
      return Object.create(null);
    }
  }

  return Object.create(null);
}

export function writeNodeResponse(res, response, method) {
  res.statusCode = response.status;

  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) res.setHeader(name, value);
  }

  if (response.body === null || response.body === undefined || method === 'HEAD') {
    res.end();
    return;
  }

  res.end(response.body);
}

/**
 * @param {import('../core/app.js').Flash} flash
 * @param {{maxBodySize?: number, logger?: {error: Function}}} [options]
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function nodeAdapter(flash, options = {}) {
  const limit = options.maxBodySize ?? DEFAULT_LIMIT;

  return async function handler(req, res) {
    try {
      const buffer = await readBody(req, limit);
      const response = await flash.handle({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: parseBody(buffer, req.headers['content-type']),
        rawBody: buffer.toString('utf8'),
        ip: req.socket?.remoteAddress ?? null,
        protocol: req.socket?.encrypted ? 'https' : 'http'
      });

      if (!(response instanceof FlashResponse)) {
        throw new TypeError('flash.handle() did not return a FlashResponse');
      }

      writeNodeResponse(res, response, req.method);
    } catch (error) {
      if (typeof options.logger?.error === 'function') options.logger.error(error);
      if (!res.headersSent) {
        res.statusCode = error.status ?? 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      res.end(error.status === 413 ? 'Payload Too Large' : 'Internal Server Error');
    }
  };
}

export function createServer(flash, options) {
  return http.createServer(nodeAdapter(flash, options));
}

/**
 * Starts an HTTP server on the given port (0 picks a free port).
 * @returns {Promise<{server: import('node:http').Server, port: number, url: string}>}
 */
export async function listen(flash, options = {}) {
  const { port = 3000, host = '127.0.0.1', ...rest } = options;
  const server = createServer(flash, rest);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  return {
    server,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

export default nodeAdapter;
