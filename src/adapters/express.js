/**
 * FLASH — Express adapter.
 *
 *   app.use(expressAdapter(flash));
 *
 * The adapter only translates between Express and FLASH: it parses the body,
 * builds a normalized request and writes the normalized response back. All
 * routing, middleware and rendering stays in the framework core.
 */

import express from 'express';
import { FlashResponse } from '../core/response.js';

/**
 * @param {import('../core/app.js').Flash} flash
 * @param {{bodyLimit?: string|number, parseJson?: boolean, logger?: {error: Function}}} [options]
 * @returns {import('express').Router}
 */
export function expressAdapter(flash, options = {}) {
  const router = express.Router();
  const bodyLimit = options.bodyLimit ?? '1mb';

  router.use(express.urlencoded({ extended: false, limit: bodyLimit }));
  if (options.parseJson !== false) {
    router.use(express.json({ limit: bodyLimit }));
  }

  router.use(async (req, res, next) => {
    try {
      const response = await flash.handle({
        method: req.method,
        path: req.originalUrl ?? req.url,
        headers: req.headers,
        body: req.body && typeof req.body === 'object' ? req.body : Object.create(null),
        ip: req.ip,
        protocol: req.protocol
      });

      if (!(response instanceof FlashResponse)) {
        throw new TypeError('flash.handle() did not return a FlashResponse');
      }

      writeResponse(res, response, req);
    } catch (error) {
      if (typeof options.logger?.error === 'function') options.logger.error(error);
      next(error);
    }
  });

  return router;
}

export function writeResponse(res, response, req) {
  res.status(response.status);

  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) res.setHeader(name, value);
  }

  if (response.body === null || response.body === undefined || req?.method === 'HEAD') {
    res.end();
    return;
  }

  res.end(response.body);
}

export default expressAdapter;
