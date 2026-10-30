/**
 * FLASH — development tools.
 *
 * When `dev` is on, the framework keeps a small debugging service active for the
 * lifetime of the process:
 *
 *   GET  /__flash/dev/stats.json                    snapshot do runtime
 *   POST /__flash/dev/actions/clear-template-cache  limpa o cache de templates
 *   POST /__flash/dev/actions/clear-requests        limpa o log de requisições
 *   GET  /__flash/dev/panel.js                      painel (servido como asset)
 *
 * The browser panel (`src/dev/panel.js`) is injected into every HTML page in dev
 * — the equivalent of Vite's client badge, but focused on server-rendered
 * requests, routes and templates.
 *
 * Nothing here exists in production: `createFlash({ dev: false })` neither serves
 * the endpoints nor injects the script.
 */

import { FlashResponse } from '../core/response.js';

export const DEVTOOLS_PREFIX = '/__flash/dev';
export const DEVTOOLS_PANEL = `${DEVTOOLS_PREFIX}/panel.js`;
export const DEVTOOLS_STATS = `${DEVTOOLS_PREFIX}/stats.json`;
const REQUESTS_LIMIT_MAX = 500;

function jsonResponse(data, status = 200) {
  return new FlashResponse({
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    body: JSON.stringify(data),
    type: 'application/json; charset=utf-8'
  });
}

function bytes(value) {
  if (value === null || value === undefined) return 0;
  return Buffer.byteLength(typeof value === 'string' ? value : String(value));
}

function toMb(value) {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

export class DevTools {
  /**
   * @param {import('../core/app.js').Flash} flash
   * @param {{requestLog?: number, overlay?: boolean, shortcut?: string, position?: 'bottom-right'|'bottom-left'}} [options]
   */
  constructor(flash, options = {}) {
    this.flash = flash;
    this.options = {
      requestLog: Math.min(options.requestLog ?? 80, REQUESTS_LIMIT_MAX),
      overlay: options.overlay ?? true,
      shortcut: options.shortcut ?? 'alt+shift+d',
      position: options.position === 'bottom-left' ? 'bottom-left' : 'bottom-right'
    };

    this.requests = [];
    this.startedAt = Date.now();
    this.counters = { requests: 0, errors: 0, fragments: 0 };
  }

  get panelSource() {
    return DEVTOOLS_PANEL;
  }

  /** Registers a finished request. Called from `Flash.finalize()`. */
  note(response, ctx) {
    if (ctx.path.startsWith(`${DEVTOOLS_PREFIX}/`)) return;

    this.counters.requests += 1;
    const isError = response.status >= 500;
    if (isError) this.counters.errors += 1;
    if (ctx.wantsFragment()) this.counters.fragments += 1;

    const entry = {
      id: ctx.requestId,
      at: Date.now(),
      method: ctx.method,
      path: ctx.url,
      status: response.status,
      durationMs: Math.round((performance.now() - ctx.startedAt) * 10) / 10,
      bytes: bytes(response.body),
      fragment: ctx.wantsFragment(),
      transition: ctx.transitionName ?? null,
      error: isError
    };

    this.requests.unshift(entry);
    if (this.requests.length > this.options.requestLog) {
      this.requests.length = this.options.requestLog;
    }
  }

  /** Handles `/__flash/dev/*`. Returns `null` so static files keep working. */
  async handle(request) {
    const pathname = request.path;

    if (!pathname.startsWith(`${DEVTOOLS_PREFIX}/`)) return null;

    if (pathname === DEVTOOLS_STATS) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonResponse({ error: 'Use GET' }, 405);
      }
      return jsonResponse(this.snapshot());
    }

    const action = /^\/__flash\/dev\/actions\/([a-z-]+)$/.exec(pathname);
    if (!action) return null;

    if (request.method !== 'POST') return jsonResponse({ error: 'Use POST' }, 405);

    switch (action[1]) {
      case 'clear-template-cache':
        this.flash.viewEngine.clearCache();
        return jsonResponse({ ok: true, cleared: 'template-cache' });

      case 'clear-requests':
        this.requests.length = 0;
        this.counters.errors = 0;
        return jsonResponse({ ok: true, cleared: 'requests' });

      default:
        return jsonResponse({ error: `Ação desconhecida: ${action[1]}` }, 404);
    }
  }

  /**
   * Adds the panel `<script>` before `</body>`.
   * @param {FlashResponse} response
   */
  inject(response) {
    if (typeof response.body !== 'string' || response.body === '') return response;

    const type = Object.entries(response.headers)
      .find(([key]) => key.toLowerCase() === 'content-type')?.[1];
    if (!String(type ?? '').toLowerCase().includes('text/html')) return response;

    if (!/<\/body\s*>/i.test(response.body)) return response;
    if (response.body.includes(DEVTOOLS_PANEL)) return response;

    const payload = JSON.stringify({
      position: this.options.position,
      overlay: this.options.overlay,
      shortcut: this.options.shortcut
    }).replace(/</g, '\\u003c');

    const tag =
      `<script type="module" src="${DEVTOOLS_PANEL}" data-flash-devtools ` +
      `data-flash-devtools-config='${payload}'></script>\n</body>`;

    response.body = response.body.replace(/<\/body\s*>/i, tag);
    return response;
  }

  /** Snapshot consumed by the panel and by `curl /__flash/dev/stats.json`. */
  snapshot() {
    const memory = process.memoryUsage();
    const engine = this.flash.viewEngine;

    const templates = [...engine.cache.values()].map((entry) => ({
      file: entry.file,
      name: entry.file.replace(/\.html$/, ''),
      kind: entry.file.startsWith('components/') ? 'component' : 'view',
      directives: [...(entry.capabilities?.directives ?? [])],
      components: [...(entry.capabilities?.components ?? [])],
      needsRuntime: Boolean(entry.capabilities?.needsRuntime)
    }));

    return {
      version: '0.1.0',
      dev: true,
      node: process.version,
      now: Date.now(),
      uptimeMs: Date.now() - this.startedAt,
      process: {
        uptimeMs: Math.round(process.uptime() * 1000),
        rssMb: toMb(memory.rss),
        heapMb: toMb(memory.heapUsed)
      },
      options: {
        overlay: this.options.overlay,
        shortcut: this.options.shortcut,
        position: this.options.position,
        requestLog: this.options.requestLog
      },
      counters: { ...this.counters, requestsLogged: this.requests.length },
      app: {
        routes: this.flash.routes().length,
        middlewares: this.flash.middlewares.length,
        templates: templates.length,
        transitions: this.flash.config.transitions,
        strict: engine.strict
      },
      routes: this.flash.routes(),
      templates,
      requests: this.requests
    };
  }
}
