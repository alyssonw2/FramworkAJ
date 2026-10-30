/**
 * FLASH UI — toasts.
 *
 * Optional module. Load it where you render `<ui:toast>` or call `toast()`:
 *
 *   <script type="module" src="/__flash/client/modules/toast.js"></script>
 *
 * Toast text is inserted with `textContent`, never as HTML.
 */

import { registerModule } from '../runtime.js';

const CONTAINER_ID = 'flash-toasts';
const DEFAULT_DURATION = 4000;

function container() {
  let element = document.getElementById(CONTAINER_ID);

  if (!element) {
    element = document.createElement('div');
    element.id = CONTAINER_ID;
    element.className = 'toast-stack';
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'false');
    document.body.append(element);
  }

  return element;
}

function scheduleDismiss(element, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  const timer = window.setTimeout(() => dismiss(element), duration);
  element.addEventListener('mouseenter', () => window.clearTimeout(timer), { once: true });
}

function reveal(element) {
  requestAnimationFrame(() => element.classList.add('is-visible'));
}

export function dismiss(element) {
  if (!element || !element.isConnected) return;
  element.classList.remove('is-visible');
  window.setTimeout(() => element.remove(), 220);
}

/**
 * Creates a toast programmatically.
 * @param {string} message
 * @param {{tone?: 'info'|'success'|'warning'|'danger', duration?: number}} [options]
 */
export function toast(message, options = {}) {
  const tone = options.tone ?? 'info';
  const duration = options.duration ?? DEFAULT_DURATION;

  const element = document.createElement('div');
  element.className = `toast toast--${tone}`;
  element.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  element.textContent = String(message ?? '');

  container().append(element);
  reveal(element);
  scheduleDismiss(element, duration);

  return element;
}

registerModule('toast', {
  init(root) {
    for (const element of root.querySelectorAll('[data-flash-toast]')) {
      if (element.dataset.flashToastReady === 'true') continue;
      element.dataset.flashToastReady = 'true';

      const duration = Number(element.getAttribute('data-flash-toast'));
      container().append(element);
      reveal(element);
      scheduleDismiss(element, Number.isFinite(duration) ? duration : DEFAULT_DURATION);

      element.addEventListener('click', () => dismiss(element));
    }
  }
});

if (typeof window !== 'undefined') {
  window.flash = Object.assign(window.flash ?? {}, { toast });
}
