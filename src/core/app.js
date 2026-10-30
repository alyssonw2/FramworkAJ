/**
 * FLASH — application core.
 *
 * `createFlash()` wires the router, the middleware pipeline, the view engine and
 * static asset serving. `flash.handle()` is adapter-independent: Express,
 * node:http and tests all feed it a normalized request and get a
 * `FlashResponse` back.
 */

import path from 'node:path';
import { Router } from './router.js';
import { Context } from './context.js';
import { ViewEngine } from '../view/engine.js';
import { TemplateError } from '../view/template.js';
import { FlashResponse, toResponse } from './response.js';
import { HttpError, ValidationError, methodNotAllowed, notFound } from './errors.js';
import { normalizeRequest } from './request.js';
import { applyPageTransition, injectTransitionAssets } from '../view/transitions.js';
import { DevTools } from '../dev/devtools.js';
import {
  createStaticRoutes,
  serveStaticFile,
  DEFAULT_RUNTIME_DIR,
  DEFAULT_RUNTIME_PREFIX
} from '../adapters/static.js';

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export class Flash {
  constructor(options = {}) {
    const dev = options.dev ?? process.env.NODE_ENV !== 'production';

    this.config = {
      dev,
      views: options.views ?? null,
      components: options.components ?? null,
      publicDir: options.publicDir ?? null,
      publicPrefix: options.publicPrefix ?? '/assets',
      runtimePrefix: options.runtimePrefix ?? DEFAULT_RUNTIME_PREFIX,
      runtimeDir: options.runtimeDir === undefined ? DEFAULT_RUNTIME_DIR : options.runtimeDir,
      maxDepth: options.maxDepth ?? 32,
      requestId: options.requestId ?? true,
      baselineHeaders: options.baselineHeaders ?? true,
      cache: options.cache ?? true,
      freeze: options.freeze ?? !dev,
      logger: options.logger ?? console
    };

    const devtoolsOption = options.devtools ?? dev;
    this.config.devtools = devtoolsOption !== false;

    const transitions = options.transitions ?? true;
    this.config.transitions = transitions !== false;
    this.config.transitionHref =
      transitions && typeof transitions === 'object' && typeof transitions.href === 'string'
        ? transitions.href
        : null;

    this.router = new Router();
    this.middlewares = [];
    this.errorHandlers = [];

    this.viewEngine = new ViewEngine({
      views: this.config.views,
      components: this.config.components,
      strict: options.strict ?? dev,
      maxDepth: this.config.maxDepth,
      helpers: options.helpers,
      cache: this.config.cache,
      freeze: this.config.freeze
    });

    this.staticRoutes = createStaticRoutes({
      publicDir: this.config.publicDir,
      publicPrefix: this.config.publicPrefix,
      runtimeDir: this.config.runtimeDir,
      runtimePrefix: this.config.runtimePrefix,
      dev
    });

    this.devtools = this.config.devtools
      ? new DevTools(this, typeof devtoolsOption === 'object' ? devtoolsOption : {})
      : null;
  }

  get dev() {
    return this.config.dev;
  }

  /** Registers middleware. Handlers return a response to stop the pipeline. */
  use(...handlers) {
    for (const handler of handlers.flat()) {
      if (typeof handler !== 'function') throw new TypeError('flash.use() expects functions');
      this.middlewares.push(handler);
    }
    return this;
  }

  /** Registers a client-side asset directory. */
  assets(dir, { prefix = '/assets', immutable = false } = {}) {
    this.config.publicDir = path.resolve(dir);
    this.staticRoutes = createStaticRoutes({
      publicDir: this.config.publicDir,
      publicPrefix: prefix,
      runtimeDir: this.config.runtimeDir,
      runtimePrefix: this.config.runtimePrefix,
      dev: this.config.dev,
      immutable
    });
    return this;
  }

  /** Registers template helpers (`{{ formatDate(x) }}`). */
  helpers(helpers) {
    this.viewEngine.registerHelpers(helpers);
    return this;
  }

  route(method, pattern, ...handlers) {
    this.router.add(method, pattern, handlers.flat());
    return this;
  }

  onError(handler) {
    if (typeof handler !== 'function') throw new TypeError('flash.onError() expects a function');
    this.errorHandlers.push(handler);
    return this;
  }

  render(name, props, options) {
    return this.viewEngine.render(name, props, options);
  }

  analyze() {
    return this.viewEngine.analyze();
  }

  routes() {
    return this.router.list();
  }

  getStats() {
    return {
      routes: this.router.routes.length,
      middlewares: this.middlewares.length,
      templates: this.viewEngine.cache.size
    };
  }

  /**
   * Handles a normalized request and returns a `FlashResponse`.
   * @param {object} input see `normalizeRequest`
   * @returns {Promise<FlashResponse>}
   */
  async handle(input) {
    const request = normalizeRequest(input);
    const method = request.method === 'HEAD' ? 'GET' : request.method;

    // Devtools endpoints answer before middleware and routing, so the panel keeps
    // working even when the app redirects everything to /login.
    if (this.devtools) {
      const devResponse = await this.devtools.handle(request);
      if (devResponse) return devResponse;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await serveStaticFile(this.staticRoutes, {
        pathname: request.path,
        method: request.method,
        headers: request.headers
      });
      if (asset) return asset;
    }

    const match = this.router.match(method, request.path);
    const ctx = new Context(this, request, {
      params: match && match.handlers ? match.params : undefined,
      route: match && match.route ? match.route : null
    });

    try {
      for (const middleware of this.middlewares) {
        const response = toResponse(await middleware(ctx));
        if (response) return this.finalize(response, ctx);
      }

      if (!match) {
        throw notFound(`Rota não encontrada: ${method} ${request.path}`);
      }

      if (!match.handlers) {
        throw methodNotAllowed(undefined, match.allowed ?? []);
      }

      for (const handler of match.handlers) {
        const response = toResponse(await handler(ctx));
        if (response) return this.finalize(response, ctx);
      }

      throw new HttpError(500, `A rota ${method} ${request.path} não retornou uma resposta`);
    } catch (error) {
      const response = await this.errorResponse(error, ctx);
      return this.finalize(response, ctx);
    }
  }

  async finalize(response, ctx) {
    let final = ctx.applyHeaders(response instanceof FlashResponse ? response : toResponse(response));

    for (const deferred of ctx.deferred) {
      const result = await deferred(final, ctx);
      if (result instanceof FlashResponse) final = result;
    }

    if (this.config.requestId && !hasHeader(final.headers, 'X-Request-Id')) {
      final.headers['X-Request-Id'] = ctx.requestId;
    }

    if (this.config.baselineHeaders) {
      if (!hasHeader(final.headers, 'X-Content-Type-Options')) {
        final.headers['X-Content-Type-Options'] = 'nosniff';
      }
      if (!hasHeader(final.headers, 'Referrer-Policy')) {
        final.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
      }
    }

    if (this.config.transitions) {
      final = this.applyTransitions(final, ctx);
    }

    if (this.devtools) {
      final = this.devtools.inject(final);
      this.devtools.note(final, ctx);
    }

    if (final.body !== null && !hasHeader(final.headers, 'Content-Length')) {
      final.headers['Content-Length'] = String(Buffer.byteLength(final.body));
    }

    return final;
  }

  /** Absolute URL of the stylesheet that opts pages into view transitions. */
  get transitionStylesheet() {
    return this.config.transitionHref ?? `${this.config.runtimePrefix}/ui/view-transitions.css`;
  }

  /**
   * Applies view transitions to a response body:
   *  - injects the stylesheet into complete HTML documents (once);
   *  - writes `data-vt="<name>"` when the controller asked for a page transition.
   */
  applyTransitions(response, ctx) {
    if (typeof response.body !== 'string' || response.body === '') return response;

    const type = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
    if (!String(type ?? '').toLowerCase().includes('text/html')) return response;

    let body = response.body;

    if (ctx.transitionName) {
      body = applyPageTransition(body, ctx.transitionName);
    }

    const injected = injectTransitionAssets(body, this.transitionStylesheet);
    if (injected.injected) body = injected.html;
    if (body === response.body) return response;

    response.body = body;
    return response;
  }

  /**
   * Turns any thrown value into a response. Application error handlers run
   * first; if none returns a response, FLASH renders `errors/<status>` when the
   * template exists and falls back to a minimal page otherwise.
   */
  async errorResponse(error, ctx) {
    const status = error instanceof HttpError ? error.status : 500;
    const expose = error instanceof HttpError ? error.expose : false;
    const isServerError = status >= 500;

    for (const handler of this.errorHandlers) {
      const result = await handler(error, ctx);
      if (result) return result;
    }

    if (isServerError) {
      this.logError(error, ctx);
    }

    const headers = error instanceof HttpError ? { ...error.headers } : {};

    if (ctx.wantsFragment() || ctx.wantsJson()) {
      if (ctx.wantsJson()) {
        return new FlashResponse({
          status,
          headers,
          type: 'application/json; charset=utf-8',
          body: JSON.stringify({
            error: expose ? error.message : 'Internal Server Error',
            code: error instanceof HttpError ? error.code : null,
            requestId: ctx.requestId
          })
        });
      }
      return new FlashResponse({
        status,
        headers,
        body:
          `<div class="flash-error" role="alert" data-status="${status}">` +
          `<strong>${expose ? escapeHtml(error.message) : 'Não foi possível concluir a operação'}</strong>` +
          `</div>`
      }).fragment({ update: 'replace' });
    }

    if (this.config.views) {
      const props = {
        ...ctx.locals,
        csrfToken: ctx.csrfToken,
        user: ctx.user ?? null,
        status,
        message: expose ? error.message : 'Erro interno do servidor',
        requestId: ctx.requestId,
        errors: error instanceof ValidationError ? error.errors : Object.create(null),
        dev: this.dev,
        stack: this.dev && isServerError ? String(error.stack ?? '') : null
      };

      for (const name of [`errors/${status}`, 'errors/error']) {
        try {
          // Error pages are rendered leniently: they must not fail because a
          // middleware that normally fills `locals` never ran.
          const body = await this.render(name, props, { strict: false });
          return new FlashResponse({ status, headers, body });
        } catch (renderError) {
          const missing =
            renderError instanceof TemplateError && /not found/i.test(renderError.message);
          if (!missing) {
            if (this.dev) this.logError(renderError, ctx);
            break;
          }
        }
      }
    }

    return new FlashResponse({
      status,
      headers,
      body: fallbackErrorPage(status, expose ? error.message : 'Erro interno do servidor', ctx.requestId)
    });
  }

  logError(error, ctx) {
    const logger = this.config.logger ?? console;
    if (typeof logger?.error !== 'function') return;

    if (this.dev) {
      logger.error(`[flash] ${ctx.method} ${ctx.path} failed (request ${ctx.requestId}):`, error);
      return;
    }

    logger.error(
      JSON.stringify({
        level: 'error',
        requestId: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        status: error instanceof HttpError ? error.status : 500,
        name: error?.name,
        message: error?.message,
        code: error instanceof HttpError ? error.code : undefined
      })
    );
  }
}

function fallbackErrorPage(status, message, requestId) {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>${status}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem;">
  <h1>${status}</h1>
  <p>${escapeHtml(message)}</p>
  <p style="color:#666;font-size:.85rem">ID da requisição: ${escapeHtml(requestId ?? '')}</p>
</body>
</html>`;
}

function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/**
 * Creates a FLASH application.
 *
 * @param {{
 *   views?: string,
 *   components?: string,
 *   publicDir?: string|null,
 *   publicPrefix?: string,
 *   runtimePrefix?: string,
 *   runtimeDir?: string|null,
 *   helpers?: Record<string, Function>,
 *   dev?: boolean,
 *   strict?: boolean,
 *   maxDepth?: number,
 *   requestId?: boolean,
 *   baselineHeaders?: boolean,
 *   cache?: boolean,
 *   freeze?: boolean,
 *   logger?: { error: Function, warn?: Function }
 * }} [options]
 */
export function createFlash(options = {}) {
  const flash = new Flash(options);

  for (const method of SUPPORTED_METHODS) {
    flash[method] = (pattern, ...handlers) => flash.route(method, pattern, ...handlers);
  }
  flash.all = (pattern, ...handlers) => flash.route('*', pattern, ...handlers);

  return flash;
}
