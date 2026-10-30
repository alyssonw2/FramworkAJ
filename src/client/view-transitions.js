/**
 * FLASH client runtime — view transitions.
 *
 * Cross-document navigations are animated by CSS alone: the stylesheet that
 * FLASH injects into every page contains `@view-transition { navigation: auto }`.
 * This module covers the *same-document* case: wrapping a DOM update (partial
 * HTML swap) in `document.startViewTransition()`.
 *
 * Everything degrades gracefully: without support, or with
 * `prefers-reduced-motion: reduce`, the update happens exactly as before.
 */

/** `data-vt` value that disables the animation for one navigation. */
export const NO_TRANSITION = 'none';

let active = null;

/** True when the browser implements the View Transitions API. */
export function supportsViewTransitions() {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

/** True when the user asked the system to reduce motion. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True when an animation should be attempted right now. */
export function canAnimate() {
  return supportsViewTransitions() && !prefersReducedMotion();
}

/**
 * Sets the page transition used by the stylesheet (`data-vt` on `<html>`).
 * Passing `null` leaves the current value untouched.
 *
 * @param {string|null|undefined} name
 */
export function setPageTransition(name) {
  if (typeof name !== 'string' || name.trim() === '') return;
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-vt', name.trim().toLowerCase());
}

/** Returns the page transition currently applied. */
export function getPageTransition() {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute('data-vt');
}

/**
 * Runs `update` inside a view transition.
 *
 * @param {() => unknown} update synchronous DOM update
 * @param {{transition?: string|null, onError?: (error: unknown) => void}} [options]
 * @returns {{animated: boolean, finished: Promise<void>|null}}
 */
export function runViewTransition(update, options = {}) {
  if (typeof update !== 'function') {
    throw new TypeError('runViewTransition() expects a function');
  }

  if (options.transition) setPageTransition(options.transition);

  if (!canAnimate() || options.transition === NO_TRANSITION) {
    update();
    return { animated: false, finished: null };
  }

  // Two overlapping transitions throw; a second update is applied directly and
  // the newer content wins (the older snapshot is simply not animated).
  if (active) {
    update();
    return { animated: false, finished: null };
  }

  try {
    const transition = document.startViewTransition(() => update());
    active = transition;

    const finished = transition.finished
      .catch(() => {})
      .finally(() => {
        if (active === transition) active = null;
      });

    transition.updateCallbackDone?.catch?.(options.onError ?? (() => {}));

    return { animated: true, finished };
  } catch (error) {
    active = null;
    options.onError?.(error);
    update();
    return { animated: false, finished: null };
  }
}

/**
 * Applies a `view-transition-name` to an element, or removes it when the value
 * is empty. Names must be unique in the document; `vtName()` on the server and
 * this helper share the same conventions.
 *
 * @param {Element|null} element
 * @param {string|null|undefined} name
 */
export function setTransitionName(element, name) {
  if (!element || !element.style) return;

  const value = typeof name === 'string' ? name.trim() : '';
  if (value === '') {
    element.style.removeProperty('view-transition-name');
    return;
  }

  element.style.setProperty('view-transition-name', value);
}

/** Skips the running transition, keeping the final state. */
export function skipTransition() {
  active?.skipTransition?.();
  active = null;
}
