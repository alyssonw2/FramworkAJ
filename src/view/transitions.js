/**
 * FLASH — HTML post-processing for view transitions.
 *
 * Two small, auditable rewrites applied to complete HTML documents:
 *
 *  1. `injectTransitionAssets()` adds the stylesheet that opts the page into
 *     `@view-transition { navigation: auto }` (the framework default), once.
 *  2. `applyPageTransition()` writes `data-vt="name"` on `<html>`, which selects
 *     the animation used by `src/ui/view-transitions.css`.
 *
 * Both are no-ops when the input is not a complete document.
 */

import { isTransitionName } from '../shared/transition-names.js';

const HTML_TAG = /<html\b[^>]*>/i;
const DATA_VT = /\sdata-vt\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i;
const HEAD_END = /<\/head\s*>/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when a `<link>` element already points at `href`. */
function loadsStylesheet(html, href) {
  return new RegExp(`<link[^>]*\\shref\\s*=\\s*["']${escapeRegExp(href)}["']`, 'i').test(html);
}

/**
 * Adds `data-vt="<name>"` to the root element. An existing value is replaced, so
 * a layout can declare a default and a route can override it.
 *
 * @param {string} html
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function applyPageTransition(html, name) {
  if (typeof html !== 'string' || !isTransitionName(name)) return html;

  const match = HTML_TAG.exec(html);
  if (!match) return html;

  const tag = match[0];
  const next = DATA_VT.test(tag)
    ? tag.replace(DATA_VT, ` data-vt="${name}"`)
    : tag.replace(/^<html/i, `<html data-vt="${name}"`);

  if (next === tag) return html;
  return html.slice(0, match.index) + next + html.slice(match.index + tag.length);
}

/**
 * Injects the view-transitions stylesheet before `</head>`.
 *
 * The link is only added when the document is complete, has a head and does not
 * already load the same file in a `<link>` element (so an app can include it
 * manually or replace it with its own stylesheet). Matching the element — not
 * the bare string — keeps pages that merely *mention* the path (documentation,
 * code samples) on the default path.
 *
 * @param {string} html
 * @param {string} href
 * @returns {{html: string, injected: boolean}}
 */
export function injectTransitionAssets(html, href) {
  if (typeof html !== 'string' || typeof href !== 'string' || href === '') {
    return { html, injected: false };
  }
  if (!HTML_TAG.test(html) || !HEAD_END.test(html)) {
    return { html, injected: false };
  }
  if (loadsStylesheet(html, href)) {
    return { html, injected: false };
  }

  const link = `<link rel="stylesheet" href="${href}" data-flash-transitions>`;
  return { html: html.replace(HEAD_END, `${link}\n</head>`), injected: true };
}
