/**
 * FLASH client runtime.
 *
 * Small, optional and dependency-free. It provides:
 *  - one delegated listener per event type used on the page;
 *  - explicit local state with registered actions (no universal reactivity);
 *  - directive application (`f-show`, `f-model`, `f-bind`, `f-class`);
 *  - form enhancement and partial HTML swaps (animated by View Transitions);
 *  - a tiny module registry for interactive components (modal, toast...).
 *
 * Usage from an application module:
 *
 *   import { client } from '/__flash/client/runtime.js';
 *
 *   client({
 *     state: { menu: { open: false }, search: '' },
 *     actions: {
 *       'menu.toggle'({ state }) {
 *         state.menu.open = !state.menu.open;
 *       }
 *     }
 *   });
 */

import { applyDirectives, collectDirectives, findAction, nearestConfirm, nearestMorph } from './directives.js';
import { setupForms, performSwap, swapWithTransition } from './forms.js';
import {
  canAnimate,
  getPageTransition,
  prefersReducedMotion,
  runViewTransition,
  setPageTransition,
  setTransitionName,
  skipTransition,
  supportsViewTransitions
} from './view-transitions.js';

export { performSwap as swap };
export {
  canAnimate,
  getPageTransition,
  prefersReducedMotion,
  runViewTransition,
  setPageTransition,
  setTransitionName,
  skipTransition,
  supportsViewTransitions,
  swapWithTransition
};

export const state = Object.create(null);
export const actions = new Map();
const modules = new Map();
const delegatedEvents = new Set();
const modelListeners = new Set();

let booted = false;

function emit(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail: { ...detail, runtime }, bubbles: true }));
}

function currentScope(extra = {}) {
  const scope = Object.create(null);
  for (const [key, value] of Object.entries(state)) scope[key] = value;
  return Object.assign(scope, extra);
}

export function collectRefs(root = document) {
  const refs = Object.create(null);
  for (const element of root.querySelectorAll('[f-ref]')) {
    refs[element.getAttribute('f-ref')] = element;
  }
  return refs;
}

/** Re-applies every directive in the document. Cheap enough for admin screens. */
export function refresh(root = document) {
  syncEventListeners(root);
  applyDirectives(root, {
    state,
    scope: currentScope(),
    onModel(path, value) {
      for (const listener of modelListeners) listener(path, value);
    }
  });
  for (const module of modules.values()) {
    try {
      module.init?.(root);
    } catch (error) {
      console.error('[flash] falha ao inicializar módulo', error);
    }
  }
  return runtime;
}

function syncEventListeners(root) {
  const { events } = collectDirectives(root);
  for (const type of events) {
    if (delegatedEvents.has(type)) continue;
    delegatedEvents.add(type);
    document.addEventListener(type, onDelegatedEvent, false);
  }
}

function onDelegatedEvent(event) {
  const found = findAction(event.target, event.type);
  if (!found) return;

  const { element, attribute, modifiers } = found;

  if (modifiers.includes('.self') && event.target !== element) return;
  if (modifiers.includes('.prevent')) event.preventDefault();
  if (modifiers.includes('.stop')) event.stopPropagation();

  const confirmTarget = nearestConfirm(element);
  if (confirmTarget && !window.confirm(confirmTarget.message)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const name = attribute.value.trim();
  if (!name) return;

  runAction(name, { event, el: element });
}

/**
 * Runs a registered action.
 *
 * @param {string} name
 * @param {{event?: Event, el?: Element, args?: unknown}} [payload]
 */
export async function runAction(name, payload = {}) {
  const action = actions.get(name);

  if (typeof action !== 'function') {
    console.warn(`[flash] ação "${name}" não registrada. Registre-a com client({ actions })`);
    return undefined;
  }

  const context = {
    state,
    event: payload.event ?? null,
    el: payload.el ?? null,
    refs: collectRefs(),
    args: payload.args,
    flash: runtime
  };

  try {
    const result = await action(context);
    refresh();
    return result;
  } catch (error) {
    console.error(`[flash] ação "${name}" falhou`, error);
    emit('flash:action-error', { error, name });
    return undefined;
  }
}

export function registerActions(map) {
  for (const [name, fn] of Object.entries(map ?? {})) {
    if (typeof fn === 'function') actions.set(name, fn);
    else console.warn(`[flash] ação "${name}" ignorada: não é uma função`);
  }
  return runtime;
}

export function defineState(initial) {
  if (!initial || typeof initial !== 'object') return state;
  for (const [key, value] of Object.entries(initial)) state[key] = value;
  return state;
}

/**
 * Registers an interactive module. `init(root)` must be idempotent;
 * `destroy(root)` runs before a region is replaced.
 */
export function registerModule(name, module) {
  modules.set(name, module);
  if (booted) {
    try {
      module.init?.(document);
    } catch (error) {
      console.error(`[flash] falha ao inicializar módulo "${name}"`, error);
    }
  }
  return runtime;
}

/** Subscribes to a runtime event. Returns an unsubscribe function. */
export function on(name, handler) {
  const listener = (event) => handler(event.detail, event);
  document.addEventListener(name, listener);
  return () => document.removeEventListener(name, listener);
}

/** Subscribes to `f-model` changes. */
export function onModelChange(handler) {
  modelListeners.add(handler);
  return () => modelListeners.delete(handler);
}

/**
 * Entry point used by application modules (and exposed as `window.flash.client`).
 *
 * @param {{state?: object, actions?: Record<string, Function>, modules?: Record<string, object>}} [config]
 */
export function client(config = {}) {
  if (config.state) defineState(config.state);
  if (config.actions) registerActions(config.actions);
  if (config.modules) {
    for (const [name, module] of Object.entries(config.modules)) registerModule(name, module);
  }
  boot();
  refresh();
  return runtime;
}

/**
 * `f-morph="name"` names the element at click time, right before the browser
 * takes the old snapshot for a cross-document (or swap) transition. The name is
 * cleared if the navigation does not happen, so the document stays consistent.
 */
function setupMorphLinks() {
  document.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const found = nearestMorph(event.target);
      if (!found) return;

      setTransitionName(found.element, found.name);
      window.setTimeout(() => {
        if (found.element.style) setTransitionName(found.element, null);
      }, 1500);
    },
    true
  );
}

function boot() {
  if (booted) return;
  booted = true;

  setupForms();
  setupMorphLinks();

  document.addEventListener('flash:cleanup', (event) => {
    for (const module of modules.values()) {
      try {
        module.destroy?.(event.detail?.target ?? document);
      } catch (error) {
        console.error('[flash] falha ao limpar módulo', error);
      }
    }
  });

  document.addEventListener('flash:update', () => refresh());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => refresh(), { once: true });
  } else {
    refresh();
  }
}

export const runtime = {
  version: '0.1.0',
  state,
  actions,
  client,
  refresh,
  runAction,
  registerActions,
  registerModule,
  defineState,
  collectRefs,
  on,
  onModelChange,
  swap: performSwap,
  swapWithTransition,
  transition: runViewTransition,
  setPageTransition,
  setTransitionName,
  supportsViewTransitions,
  prefersReducedMotion,
  emit
};

if (typeof window !== 'undefined') {
  window.flash = Object.assign(window.flash ?? {}, runtime);
}

// The runtime boots itself so pages that only use f-show/f-model work without
// any application script.
boot();
