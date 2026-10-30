/**
 * FLASH — core template helpers.
 *
 * Available in every expression, on the server and in the browser. They are
 * deliberately free of formatting policy: applications register their own
 * helpers with `flash.helpers()`.
 */

import { registerGlobalHelpers } from './expression.js';
import { vtName } from './transition-names.js';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** `true`/`false` as text, useful for `aria-*` attributes. */
export function bool(value) {
  return value ? 'true' : 'false';
}

/** Returns `fallback` when the value is null, undefined or an empty string. */
export function defaultValue(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

/** Joins list values, ignoring null/undefined entries. */
export function join(list, separator = ', ') {
  if (Array.isArray(list)) return list.filter((item) => item !== null && item !== undefined).join(separator);
  if (list === null || list === undefined) return '';
  return String(list);
}

export function upper(value) {
  return value === null || value === undefined ? '' : String(value).toUpperCase();
}

export function lower(value) {
  return value === null || value === undefined ? '' : String(value).toLowerCase();
}

export function truncate(value, length = 80, suffix = '…') {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length > length ? text.slice(0, length) + suffix : text;
}

/** Escapes text for HTML; handy when composing strings inside templates. */
export function htmlEscape(value) {
  return value === null || value === undefined
    ? ''
    : String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Converts `snake_case`/`kebab-case` into `Title Case`. */
export function titleize(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

/** Case-sensitive prefix test; methods cannot be called from expressions. */
export function startsWith(value, prefix) {
  return String(value ?? '').startsWith(String(prefix ?? ''));
}

/** Case-sensitive substring test. */
export function contains(value, search) {
  return String(value ?? '').includes(String(search ?? ''));
}

registerGlobalHelpers({
  bool,
  default: defaultValue,
  join,
  upper,
  lower,
  truncate,
  htmlEscape,
  titleize,
  startsWith,
  contains,
  vtName
});
