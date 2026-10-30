/**
 * FLASH — context-aware escaping.
 *
 * Every interpolated value is escaped by default. Raw HTML is only possible
 * through an explicit, documented API: the `safeHtml()` helper or a block
 * already rendered by the engine.
 *
 * The escaping rules are shared with the browser runtime so both sides agree on
 * what "text" and "attribute" mean.
 */

import { registerGlobalHelpers } from './expression.js';
import './helpers.js';

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
};

const HTML_ENTITY_RE = /[&<>"'`]/g;

/** Marker symbol that survives serialization boundaries between modules. */
export const SAFE_HTML = Symbol.for('flash.safe-html');

const HTML_SCHEMES = /^(?:javascript|data|vbscript):/i;
const SAFE_DATA_URL = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Marks a string as trusted HTML. Only use with content you produced yourself
 * (or sanitized with a dedicated library). Never pass user input directly.
 */
export class SafeHtml {
  #value;

  constructor(value) {
    this.#value = value === null || value === undefined ? '' : String(value);
    Object.defineProperty(this, SAFE_HTML, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }

  toString() {
    return this.#value;
  }

  toJSON() {
    return this.#value;
  }
}

/**
 * Declares a string as trusted HTML.
 * @param {unknown} value
 * @returns {SafeHtml}
 */
export function safeHtml(value) {
  if (value instanceof SafeHtml) return value;
  return new SafeHtml(value);
}

/** @param {unknown} value */
export function isSafeHtml(value) {
  return Boolean(value) && typeof value === 'object' && value[SAFE_HTML] === true;
}

/**
 * Converts any value to the text that should appear in the document.
 * Objects and arrays are serialized to JSON, which is predictable and prevents
 * accidental `[object Object]` output. Functions and symbols are programming
 * errors and always throw.
 *
 * @param {unknown} value
 * @param {{expression?: string}} [options]
 * @returns {string}
 */
export function toText(value, options = {}) {
  if (value === null || value === undefined) return '';
  const type = typeof value;
  if (type === 'string') return value;
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  if (type === 'function' || type === 'symbol') {
    throw new TypeError(
      `A template tried to output a ${type}${options.expression ? ` from "${options.expression}"` : ''}. ` +
        'Return data from controllers instead of functions.'
    );
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (isSafeHtml(value)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Escapes text for an HTML text node.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value, options = {}) {
  if (isSafeHtml(value)) return String(value);
  const text = toText(value, options);
  if (text === '') return '';
  return text.replace(HTML_ENTITY_RE, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Escapes a value for an HTML attribute value (always double-quoted by the
 * renderer). Quotes, angle brackets and backticks are escaped so an attribute
 * cannot be closed or a tag opened.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeAttribute(value, options = {}) {
  return escapeHtml(value, options);
}

/**
 * Validates a URL before placing it in `href`, `src`, `action` and friends.
 * Returns `#` for dangerous schemes (`javascript:`, `vbscript:` and non-image
 * `data:` URLs).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function safeUrl(value) {
  const text = toText(value);
  const compact = text.replace(/[\u0000-\u0020]+/g, '');
  if (HTML_SCHEMES.test(compact) && !SAFE_DATA_URL.test(compact)) return '#';
  return text;
}

/**
 * Sanitizes a value interpolated inside `<style>`.
 *
 * Structural characters (`{}`, `()`, `;`, `:`, `@`, quotes, backslash) are
 * removed so a value can never close a declaration or open a new rule. Names,
 * numbers and simple keywords survive intact, which is what generated CSS needs
 * (`--flash-vt-duration`, `flash-row-12`, `35ms`).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCss(value) {
  if (isSafeHtml(value)) return String(value);
  return toText(value)
    .replace(/[<>{}();:@\\'"`]/g, '')
    .replace(/\/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

registerGlobalHelpers({ safeHtml, safeUrl });

/**
 * Wraps a rendered template fragment so parents can output it without escaping.
 * Used by the view engine for `{{#content}}` blocks and component slots.
 * @param {string} html
 */
export function trustedFragment(html) {
  return new SafeHtml(html);
}
