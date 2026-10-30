/**
 * FLASH client runtime — progressive form enhancement.
 *
 * Without JavaScript a FLASH form is a normal HTML form. With JavaScript and the
 * `f-submit="ajax"` attribute the runtime posts it in the background and swaps
 * the response into the element named by `f-target`.
 *
 * Server contract (see docs/08-formularios-e-html-parcial.md):
 *   X-Flash-Update: replace | append | prepend | none
 *   X-Flash-Target: <css selector>    (optional override)
 *   X-Flash-Redirect: <url>           (used instead of a 303 for fragment requests)
 *   X-Flash-Transition: <data-vt>     (animation for the swap)
 *
 * Every swap runs inside a View Transition when the browser supports it, so
 * partial updates animate exactly like full page navigations.
 *
 * File inputs are intentionally not supported here: uploads must use the plain
 * HTML form submission so the browser streams the multipart body.
 */

import { nearestConfirm } from './directives.js';
import { runViewTransition } from './view-transitions.js';

export const FRAGMENT_HEADER = 'X-Flash-Request';
export const FRAGMENT_VALUE = 'fragment';

function emit(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
}

/**
 * Replaces a region, without animation.
 * @param {Element|null} target
 * @param {string} html
 * @param {'replace'|'append'|'prepend'|'none'} [mode]
 */
export function performSwap(target, html, mode = 'replace') {
  if (!target) return false;

  target.dispatchEvent(new CustomEvent('flash:cleanup', { detail: { target }, bubbles: true }));

  if (mode === 'none') return false;
  if (mode === 'append') target.insertAdjacentHTML('beforeend', html);
  else if (mode === 'prepend') target.insertAdjacentHTML('afterbegin', html);
  else target.innerHTML = html;

  emit('flash:update', { target, mode });
  return true;
}

/**
 * Replaces a region inside a View Transition when available.
 *
 * @param {Element|null} target
 * @param {string} html
 * @param {'replace'|'append'|'prepend'|'none'} [mode]
 * @param {{transition?: string|null}} [options]
 */
export function swapWithTransition(target, html, mode = 'replace', options = {}) {
  if (!target) return false;

  const { animated } = runViewTransition(() => performSwap(target, html, mode), {
    transition: options.transition ?? null,
    onError: (error) => console.warn('[flash] falha na transição de atualização', error)
  });

  return animated || mode !== 'none';
}

function normalizeMethod(form) {
  const method = (form.getAttribute('method') ?? 'GET').toUpperCase();
  const override = form.querySelector('input[name="_method"]');
  if (override && method === 'POST') return String(override.value).toUpperCase();
  return method;
}

function serialize(form, submitter) {
  const data = new FormData(form);
  if (submitter?.name) data.append(submitter.name, submitter.value ?? '');

  const params = new URLSearchParams();
  for (const [key, value] of data) {
    if (typeof value === 'string') params.append(key, value);
  }
  return params;
}

/**
 * Installs the delegated `submit` listener.
 * @param {{onError?: (info: {response: Response, html: string}) => void}} [options]
 */
export function setupForms(options = {}) {
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const confirmTarget = nearestConfirm(event.submitter ?? form) ?? nearestConfirm(form);
    if (confirmTarget && !window.confirm(confirmTarget.message)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const mode = form.getAttribute('f-submit');
    if (mode !== 'ajax') return;

    event.preventDefault();
    submitAjax(form, event.submitter, options);
  });
}

async function submitAjax(form, submitter, options) {
  if (form.dataset.flashPending === 'true') return;
  form.dataset.flashPending = 'true';
  form.setAttribute('aria-busy', 'true');
  if (submitter) submitter.disabled = true;

  const method = normalizeMethod(form);
  const action = form.getAttribute('action') || window.location.href;
  const targetSelector = form.getAttribute('f-target');
  // `f-transition` on the form overrides the page transition for this swap.
  const formTransition = form.getAttribute('f-transition');
  const localTarget = targetSelector ? document.querySelector(targetSelector) : null;

  const headers = {
    [FRAGMENT_HEADER]: FRAGMENT_VALUE,
    Accept: 'text/html'
  };

  let url = action;
  const init = { method, headers, credentials: 'same-origin', redirect: 'follow' };

  const params = serialize(form, submitter);

  if (method === 'GET' || method === 'HEAD') {
    const query = params.toString();
    if (query) url += (url.includes('?') ? '&' : '?') + query;
  } else {
    init.body = params;
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  }

  try {
    const response = await fetch(url, init);
    const redirectTo = response.headers.get('X-Flash-Redirect');

    if (redirectTo) {
      window.location.assign(redirectTo);
      return;
    }

    if (response.redirected && response.url) {
      window.location.assign(response.url);
      return;
    }

    const html = await response.text();
    const update = (response.headers.get('X-Flash-Update') ?? 'replace').toLowerCase();
    const headerTarget = response.headers.get('X-Flash-Target');
    const transition = response.headers.get('X-Flash-Transition') ?? formTransition;
    const destination = headerTarget ? document.querySelector(headerTarget) : localTarget;

    const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');

    if (destination && isHtml && (response.ok || response.status < 500)) {
      swapWithTransition(destination, html, update, { transition });
    } else if (!response.ok) {
      if (typeof options.onError === 'function') {
        options.onError({ response, html });
      } else {
        console.warn(`[flash] ${method} ${url} respondeu ${response.status}`);
      }
      if (destination && isHtml) swapWithTransition(destination, html, update, { transition });
    } else if (!destination && /<html[\s>]/i.test(html)) {
      window.location.assign(response.url || window.location.href);
    } else if (!destination) {
      console.warn('[flash] resposta recebida sem f-target; a página não foi atualizada');
    }
  } catch (error) {
    console.error('[flash] falha ao enviar o formulário', error);
    emit('flash:request-error', { error, form });
  } finally {
    form.dataset.flashPending = 'false';
    form.removeAttribute('aria-busy');
    if (submitter) submitter.disabled = false;
  }
}
