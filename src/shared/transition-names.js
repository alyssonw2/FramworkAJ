/**
 * FLASH — view transition names.
 *
 * Shared by the server (the `vtName()` template helper) and by documentation
 * tooling. A view-transition-name must be:
 *   - a valid CSS identifier (no leading digit);
 *   - unique per document (two elements with the same name skip the animation);
 *   - stable between two pages for shared-element ("morph") transitions.
 */

/** Names accepted by the `data-vt` page transition attribute. */
export const PAGE_TRANSITIONS = Object.freeze([
  'fade',
  'slide',
  'slide-back',
  'slide-up',
  'scale',
  'curtain',
  'blur',
  'flip',
  'none'
]);

const TRANSITION_NAME = /^[a-z][a-z0-9-]{0,59}$/;
const MAX_LENGTH = 60;

/**
 * True when the value can be used as a page transition (`data-vt`).
 * @param {unknown} value
 */
export function isTransitionName(value) {
  return typeof value === 'string' && TRANSITION_NAME.test(value);
}

/**
 * Builds a unique, CSS-safe view-transition-name.
 *
 *   vtName('client', '3f2a-9c')  →  'flash-client-3f2a-9c'
 *   vtName('card', 42)           →  'flash-card-42'
 *   vtName('hero')               →  'flash-hero'
 *
 * @param {string} prefix
 * @param {string|number} [id]
 * @returns {string}
 */
export function vtName(prefix, id) {
  const base = String(prefix ?? 'vt')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '');

  const suffix = id === undefined || id === null
    ? ''
    : String(id)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

  const name = `flash-${base || 'vt'}${suffix ? `-${suffix}` : ''}`
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_LENGTH);

  return TRANSITION_NAME.test(name) ? name : 'flash-vt';
}
