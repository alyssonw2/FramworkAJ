/**
 * FLASH — request context.
 *
 * `ctx` is the only object controllers receive. It exposes request data and the
 * response helpers documented in the specification, plus a small locals bag for
 * values shared with every render call.
 */

import { FlashResponse, html, text, json, redirect as redirectResponse, empty } from './response.js';
import {
  HttpError,
  forbidden,
  notFound,
  unauthorized,
  ValidationError
} from './errors.js';

const FRAGMENT_HEADER = 'x-flash-request';
const FRAGMENT_VALUE = 'fragment';

export class Context {
  /**
   * @param {import('./app.js').Flash} flash
   * @param {object} request normalized request
   * @param {{params?: Record<string,string>}} [options]
   */
  constructor(flash, request, options = {}) {
    this.flash = flash;
    this.request = request;
    this.params = options.params ?? Object.create(null);
    this.query = request.query;
    this.body = request.body ?? Object.create(null);
    this.session = null;
    this.user = undefined;
    this.locals = Object.create(null);
    this.csrfToken = options.csrfToken ?? null;
    this.requestId = request.id;
    this.transitionName = null;
    this.status = 200;
    this.headers = Object.create(null);
    this.deferred = [];
    this.startedAt = performance.now();
    this.route = options.route ?? null;

    const accept = String(request.headers.accept ?? '');
    this.acceptsHtml = accept === '' || accept.includes('text/html') || accept.includes('*/*');
    this.acceptsJson = accept.includes('application/json');
  }

  get method() {
    return this.request.method;
  }

  get path() {
    return this.request.path;
  }

  get url() {
    return this.request.url;
  }

  get ip() {
    return this.request.ip;
  }

  get protocol() {
    return this.request.protocol;
  }

  /** True when the request came from the FLASH client runtime. */
  wantsFragment() {
    return String(this.request.headers[FRAGMENT_HEADER] ?? '') === FRAGMENT_VALUE;
  }

  /** True when the client asked for JSON explicitly. */
  wantsJson() {
    return this.acceptsJson && !this.acceptsHtml;
  }

  /** Reads a value from the body, then from the query string. */
  input(name, fallback = undefined) {
    if (this.body && Object.hasOwn(this.body, name)) return this.body[name];
    if (this.query && Object.hasOwn(this.query, name)) return this.query[name];
    return fallback;
  }

  /** Trims a string input, returning '' for missing values. */
  string(name, fallback = '') {
    const value = this.input(name, fallback);
    if (value === null || value === undefined) return fallback;
    if (Array.isArray(value)) return String(value[0] ?? fallback).trim();
    return String(value).trim();
  }

  number(name, fallback = 0) {
    const value = Number(this.input(name, fallback));
    return Number.isFinite(value) ? value : fallback;
  }

  boolean(name, fallback = false) {
    const value = this.input(name, undefined);
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
  }

  header(name, value) {
    this.headers[name] = value;
    return this;
  }

  /**
   * Registers a callback that runs after the controller returns and before the
   * response is serialized. Used by session, CSRF and security middleware.
   */
  defer(fn) {
    this.deferred.push(fn);
    return this;
  }

  applyHeaders(response) {
    for (const [name, value] of Object.entries(this.headers)) {
      response.headers[name] = value;
    }
    return response;
  }

  /**
   * Chooses the page transition (`data-vt`) used when this HTML is shown by a
   * cross-document navigation. Names ship with `view-transitions.css`:
   * `fade`, `slide`, `slide-back`, `slide-up`, `scale`, `curtain`, `blur`,
   * `flip`, `none`.
   *
   * @param {string|null} name
   */
  transition(name) {
    this.transitionName = typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
    return this;
  }

  /**
   * Renders a view. Automatically exposes `csrfToken` and `requestId` so
   * templates can include the CSRF field without extra plumbing.
   *
   * @param {string} name
   * @param {Record<string, unknown>} [props]
   * @param {{status?: number, headers?: Record<string,string>, transition?: string}} [options]
   */
  async render(name, props = {}, options = {}) {
    const viewProps = Object.assign(Object.create(null), this.locals, props);

    if (viewProps.csrfToken === undefined && this.csrfToken) viewProps.csrfToken = this.csrfToken;
    if (viewProps.requestId === undefined) viewProps.requestId = this.requestId;
    if (viewProps.currentPath === undefined) viewProps.currentPath = this.path;
    if (viewProps.user === undefined && this.user !== undefined) viewProps.user = this.user;
    if (viewProps.errors === undefined) viewProps.errors = Object.create(null);

    // Available to layouts as `{{ transition }}` so a template can decide where
    // the attribute goes; `applyTransitions()` also rewrites `<html>`.
    if (options.transition) {
      viewProps.transition = options.transition;
      this.transition(options.transition);
    }

    const body = await this.flash.render(name, viewProps);

    return new FlashResponse({
      status: options.status ?? this.status,
      headers: options.headers,
      body
    });
  }

  /**
   * Renders a view as an HTML fragment for a partial update.
   * Declares the update strategy with `X-Flash-Update` so the runtime knows
   * what to do with the response.
   *
   * @param {string} name
   * @param {Record<string, unknown>} [props]
   * @param {{status?: number, target?: string|null, update?: 'replace'|'append'|'prepend', transition?: string}} [options]
   */
  async fragment(name, props = {}, options = {}) {
    const response = await this.render(name, props, options);

    if (options.transition) {
      response.headers['X-Flash-Transition'] = options.transition;
    }

    return response.fragment({ target: options.target ?? null, update: options.update ?? 'replace' });
  }

  /** HTML without a template. Values must already be safe. */
  html(body, options = {}) {
    return html(body, { status: options.status ?? this.status, headers: options.headers });
  }

  text(body, options = {}) {
    return text(body, { status: options.status ?? this.status, headers: options.headers });
  }

  json(data, options = {}) {
    return json(data, { status: options.status ?? this.status, headers: options.headers });
  }

  redirect(location, status = 303) {
    // Fragment requests cannot follow a 303 without losing the target, so the
    // runtime is told to navigate through a response header instead.
    if (this.wantsFragment()) {
      return new FlashResponse({
        status: 200,
        headers: { 'X-Flash-Redirect': location },
        body: '',
        type: null
      });
    }
    return redirectResponse(location, { status });
  }

  empty(status = 204) {
    return empty(status);
  }

  notFound(message) {
    return notFound(message);
  }

  forbidden(message) {
    return forbidden(message);
  }

  unauthorized(message) {
    return unauthorized(message);
  }

  invalid(errors, message) {
    return new ValidationError(errors, message);
  }

  /** Requires an authenticated user, throwing 401 otherwise. */
  requireUser(message) {
    if (!this.user) throw unauthorized(message);
    return this.user;
  }

  /** Requires one of the given roles, throwing 403 otherwise. */
  requireRole(...roles) {
    const user = this.requireUser();
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean);
    const allowed = roles.flat();
    if (!allowed.some((role) => userRoles.includes(role))) {
      throw new HttpError(403, 'Acesso negado');
    }
    return user;
  }
}

export { FRAGMENT_HEADER, FRAGMENT_VALUE };
