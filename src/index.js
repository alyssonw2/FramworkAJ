/**
 * FLASH — Fast Lightweight Application Server-rendered HTML.
 *
 * Public entry point. Server-only helpers live here; browser assets are served
 * from `/__flash/...` and the adapters have their own subpaths:
 *
 *   import { createFlash } from 'flash';
 *   import { expressAdapter } from 'flash/express';
 *   import { session } from 'flash/session';
 *   import { csrf } from 'flash/csrf';
 *   import { securityHeaders } from 'flash/security';
 *   import { rateLimit } from 'flash/rate-limit';
 */

export { createFlash, Flash } from './core/app.js';
export { Context } from './core/context.js';
export { Router } from './core/router.js';
export { normalizeRequest, parseQueryString, parseCookies } from './core/request.js';
export {
  FlashResponse,
  toResponse,
  html,
  text,
  json,
  redirect,
  empty
} from './core/response.js';
export {
  HttpError,
  ValidationError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  unprocessable,
  tooManyRequests
} from './core/errors.js';

export { ViewEngine } from './view/engine.js';
export {
  parseTemplate,
  TemplateError,
  collectCapabilities,
  isComponentTag,
  VOID_ELEMENTS
} from './view/template.js';
export { TemplateRenderer } from './view/renderer.js';

export {
  parseExpression,
  evaluateExpression,
  evaluateAst,
  compileExpression,
  clearExpressionCache,
  registerGlobalHelpers,
  isIdentifier,
  ExpressionError,
  EXPRESSION_LIMITS
} from './shared/expression.js';

export {
  escapeHtml,
  escapeAttribute,
  safeHtml,
  safeUrl,
  isSafeHtml,
  toText,
  trustedFragment,
  SafeHtml,
  SAFE_HTML
} from './shared/escaping.js';

export {
  MIME_TYPES,
  DEFAULT_RUNTIME_DIR,
  DEFAULT_RUNTIME_PREFIX
} from './adapters/static.js';

export {
  PAGE_TRANSITIONS,
  isTransitionName,
  vtName
} from './shared/transition-names.js';

export {
  applyPageTransition,
  injectTransitionAssets
} from './view/transitions.js';

export {
  DevTools,
  DEVTOOLS_PREFIX,
  DEVTOOLS_PANEL,
  DEVTOOLS_STATS
} from './dev/devtools.js';
