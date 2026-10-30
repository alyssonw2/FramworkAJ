/**
 * FLASH UI — accessible modal module.
 *
 * Optional: load it from the page that uses `<ui:modal>`.
 *
 *   <script type="module" src="/__flash/client/modules/modal.js"></script>
 *
 * Behavior:
 *  - `[data-flash-open="modal-id"]` opens a modal;
 *  - `[data-flash-close]` and the backdrop close it;
 *  - Escape closes the topmost modal, focus returns to the opener;
 *  - Tab is trapped inside the dialog while it is open.
 */

import { registerModule } from '../runtime.js';

const OPEN_CLASS = 'is-open';
const BODY_CLASS = 'flash-modal-open';
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

let lastFocused = null;

function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

function openModals() {
  return [...document.querySelectorAll('[data-flash-modal].is-open')];
}

export function open(target) {
  const modal = typeof target === 'string'
    ? document.getElementById(target.replace(/^#/, ''))
    : target;

  if (!modal) {
    console.warn(`[flash] modal "${target}" não encontrado`);
    return null;
  }

  lastFocused = document.activeElement;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add(OPEN_CLASS);
  document.body.classList.add(BODY_CLASS);

  const dialog = modal.querySelector('[role="dialog"]') ?? modal;
  const first = focusableIn(dialog)[0];
  (first ?? dialog).focus?.({ preventScroll: true });

  document.dispatchEvent(new CustomEvent('flash:modal-open', { detail: { modal }, bubbles: true }));
  return modal;
}

export function close(target) {
  const modal = target ?? openModals().pop();
  if (!modal) return null;

  modal.classList.remove(OPEN_CLASS);
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');

  if (openModals().length === 0) document.body.classList.remove(BODY_CLASS);

  if (lastFocused && typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
    lastFocused.focus({ preventScroll: true });
  }
  lastFocused = null;

  document.dispatchEvent(new CustomEvent('flash:modal-close', { detail: { modal }, bubbles: true }));
  return modal;
}

export function closeAll() {
  for (const modal of openModals()) close(modal);
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const opener = target.closest('[data-flash-open]');
  if (opener) {
    event.preventDefault();
    open(opener.getAttribute('data-flash-open'));
    return;
  }

  const closer = target.closest('[data-flash-close]');
  if (closer) {
    event.preventDefault();
    close(closer.closest('[data-flash-modal]'));
    return;
  }

  if (target.closest('[data-flash-backdrop]')) {
    close(target.closest('[data-flash-modal]'));
  }
});

document.addEventListener('keydown', (event) => {
  const modal = openModals().pop();
  if (!modal) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    close(modal);
    return;
  }

  if (event.key !== 'Tab') return;

  const dialog = modal.querySelector('[role="dialog"]') ?? modal;
  const items = focusableIn(dialog);
  if (items.length === 0) return;

  const first = items[0];
  const last = items[items.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

// Actions available to `f-on:click="modal.open"` style usage.
const actions = {
  'modal.open': ({ el, args }) => open(args ?? el?.getAttribute('data-flash-open')),
  'modal.close': ({ el }) => close(el?.closest('[data-flash-modal]')),
  'modal.closeAll': () => closeAll()
};

registerModule('modal', {
  init(root) {
    for (const modal of root.querySelectorAll('[data-flash-modal]')) {
      if (modal.dataset.flashModalReady === 'true') continue;
      modal.dataset.flashModalReady = 'true';
      modal.setAttribute('aria-hidden', modal.classList.contains(OPEN_CLASS) ? 'false' : 'true');
      const dialog = modal.querySelector('[role="dialog"]');
      if (dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    }
  }
});

if (typeof window !== 'undefined' && window.flash?.registerActions) {
  window.flash.registerActions(actions);
}

export { actions as modalActions };

if (typeof window !== 'undefined') {
  window.flash = Object.assign(window.flash ?? {}, { modal: { open, close, closeAll } });
}
