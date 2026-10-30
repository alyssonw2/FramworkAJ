/**
 * FLASH devtools — debug panel (development only).
 *
 * Injected automatically by the server when `dev` is on. The UI lives in a Shadow
 * DOM so page styles can never reach it (and vice versa).
 *
 * - badge flutuante com contador de erros
 * - painel com abas: Requisições, Rotas, Templates, Página, Erros
 * - overlay de erro no estilo do Vite
 * - atalho Alt+Shift+D
 *
 * The server injects this file only in development, and only the endpoints it
 * talks to exist in development.
 */

import {
  actions as registeredActions,
  getPageTransition,
  prefersReducedMotion,
  state as clientState,
  supportsViewTransitions
} from '../client/runtime.js';

const PREFIX = '/__flash/dev';
const STATS_URL = `${PREFIX}/stats.json`;
const STORAGE_KEY = 'flash.devtools';
const SHORTCUT = 'alt+shift+d';
const MAX_ERRORS = 40;

const scriptTag = document.querySelector('script[data-flash-devtools]');
const config = (() => {
  try {
    return JSON.parse(scriptTag?.getAttribute('data-flash-devtools-config') ?? '{}');
  } catch {
    return {};
  }
})();

const ui = {
  open: false,
  tab: 'requests',
  stats: null,
  offline: false,
  clientErrors: [],
  overlayVisible: false,
  filter: ''
};

/* ---------- helpers ---------- */

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return element;
}

function timeOf(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour12: false });
}

function ms(value) {
  if (!Number.isFinite(value)) return '—';
  return value < 10 ? `${value.toFixed(1)}ms` : `${Math.round(value)}ms`;
}

function kb(value) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  return `${Math.round(value / 1024)} kB`;
}

function shortUptime(value) {
  const total = Math.round(value / 1000);
  const minutes = Math.floor(total / 60);
  if (minutes < 1) return `${total}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}min`;
  return `${hours}h ${minutes % 60}min`;
}

function statusClass(status) {
  if (status >= 500) return 'status status--error';
  if (status >= 400) return 'status status--warn';
  if (status >= 300) return 'status status--redirect';
  return 'status status--ok';
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: ui.open, tab: ui.tab }));
  } catch {
    /* storage may be blocked */
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved) {
      ui.open = Boolean(saved.open);
      if (typeof saved.tab === 'string') ui.tab = saved.tab;
    }
  } catch {
    /* ignore */
  }
}

/* ---------- error capture ---------- */

function recordError(entry) {
  ui.clientErrors.unshift({ at: Date.now(), ...entry });
  if (ui.clientErrors.length > MAX_ERRORS) ui.clientErrors.length = MAX_ERRORS;
  updateBadge();
  if (ui.open) renderContent();
  // `overlay` is the user preference (data-flash-devtools-config), not UI state.
  if (config.overlay !== false && entry.fatal !== false && entry.showOverlay !== false) {
    showOverlay(entry);
  }
}

function installErrorHandlers() {
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window && event.target.nodeType === 1) {
      recordError({
        source: 'recurso',
        message: `Falha ao carregar ${event.target.tagName?.toLowerCase() ?? 'recurso'}`,
        detail: event.target.src || event.target.href || '',
        fatal: false
      });
      return;
    }

    recordError({
      source: 'runtime',
      message: event.message || 'Erro não identificado',
      detail: `${event.filename ?? ''}:${event.lineno ?? 0}:${event.colno ?? 0}`,
      stack: event.error?.stack ?? null
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordError({
      source: 'promise',
      message: String(reason?.message ?? reason ?? 'Promise rejeitada'),
      detail: reason?.name ?? '',
      stack: reason?.stack ?? null
    });
  });

  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try {
        if (args[0] && !String(args[0]).includes('[flash]')) {
          recordError({
            source: `console.${level}`,
            message: args.map((arg) => (typeof arg === 'string' ? arg : safeString(arg))).join(' '),
            fatal: false,
            showOverlay: false
          });
        }
      } catch {
        /* never break logging */
      }
      original(...args);
    };
  }

  document.addEventListener('flash:request-error', (event) => {
    recordError({
      source: 'flash',
      message: 'Falha na requisição de fragmento',
      detail: String(event.detail?.error?.message ?? ''),
      showOverlay: false
    });
  });

  document.addEventListener('flash:action-error', (event) => {
    recordError({
      source: 'ação',
      message: `A ação "${event.detail?.name}" falhou`,
      detail: String(event.detail?.error?.message ?? ''),
      stack: event.detail?.error?.stack ?? null
    });
  });
}

function safeString(value) {
  try {
    if (value instanceof Error) return value.message;
    if (typeof value === 'object') return JSON.stringify(value, null, 0).slice(0, 300);
    return String(value);
  } catch {
    return '[objeto não serializável]';
  }
}

/* ---------- UI ---------- */

const STYLES = `
  :host {
    all: initial;
    position: fixed;
    z-index: 2147483647;
    inset: auto 0 0 auto;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    color: #e6e9ef;
    line-height: 1.45;
  }
  :host([data-position="bottom-left"]) { inset: auto auto 0 0; }

  * { box-sizing: border-box; }

  .badge {
    position: fixed;
    right: 14px;
    bottom: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: #14181f;
    color: #e6e9ef;
    font: inherit;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: .02em;
    cursor: pointer;
    box-shadow: 0 6px 22px -8px rgba(0, 0, 0, .6), 0 0 0 1px rgba(255, 255, 255, .08) inset;
    transition: transform .12s ease, background .12s ease;
  }
  .badge:hover { background: #1c2230; transform: translateY(-1px); }
  .badge:focus-visible { outline: 2px solid #7ba2ff; outline-offset: 2px; }
  :host([data-position="bottom-left"]) .badge { right: auto; left: 14px; }

  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #3ddc84;
    box-shadow: 0 0 0 3px rgba(61, 220, 132, .18);
  }
  .dot--offline { background: #ff6b6b; box-shadow: 0 0 0 3px rgba(255, 107, 107, .18); }

  .badge__count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #d2354a;
    color: #fff;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .panel {
    position: fixed;
    right: 14px;
    bottom: 60px;
    width: min(440px, calc(100vw - 28px));
    height: min(560px, calc(100vh - 90px));
    display: flex;
    flex-direction: column;
    background: #0f1319;
    color: #dfe4ee;
    border-radius: 12px;
    border: 1px solid #232b39;
    box-shadow: 0 24px 60px -24px rgba(0, 0, 0, .8);
    overflow: hidden;
    animation: pop .14s ease-out;
  }
  :host([data-position="bottom-left"]) .panel { right: auto; left: 14px; }

  @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.99); } }

  @media (prefers-reduced-motion: reduce) {
    .panel { animation: none; }
    .badge { transition: none; }
  }

  .panel__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: #141a23;
    border-bottom: 1px solid #232b39;
  }

  .panel__title {
    font-weight: 700;
    font-size: 12px;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #93a4c7;
  }

  .panel__meta { margin-left: auto; font-size: 11px; color: #6f7d94; display: flex; gap: 8px; }

  .icon-button {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid #2a3441;
    border-radius: 6px;
    background: transparent;
    color: #a9b6cc;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .icon-button:hover { background: #1d2530; color: #fff; }
  .icon-button:focus-visible { outline: 2px solid #7ba2ff; outline-offset: 1px; }

  .tabs { display: flex; gap: 2px; padding: 6px 8px 0; background: #0f1319; }
  .tab {
    border: 0;
    background: transparent;
    color: #7f8da4;
    font: inherit;
    font-size: 12px;
    padding: 6px 9px;
    border-radius: 7px 7px 0 0;
    cursor: pointer;
  }
  .tab:hover { color: #cfd7e5; background: #161c25; }
  .tab[aria-selected="true"] { color: #fff; background: #1a2230; font-weight: 600; }
  .tab:focus-visible { outline: 2px solid #7ba2ff; outline-offset: -2px; }
  .tab__count {
    margin-left: 5px; font-size: 10px; padding: 0 4px; border-radius: 6px;
    background: #2a3441; color: #b7c3d6;
  }

  .content { flex: 1; overflow: auto; padding: 10px; }
  .content::-webkit-scrollbar { width: 10px; }
  .content::-webkit-scrollbar-thumb { background: #263140; border-radius: 6px; border: 3px solid #0f1319; }

  .empty { color: #6f7d94; font-size: 12px; padding: 14px 6px; text-align: center; }

  .row {
    display: grid;
    grid-template-columns: 62px 46px 1fr 54px;
    gap: 8px;
    align-items: center;
    padding: 5px 6px;
    border-radius: 6px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .row + .row { border-top: 1px solid #161c25; }
  .row:hover { background: #141a23; }
  .row--error { background: rgba(210, 53, 74, .08); }

  .muted { color: #6f7d94; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path em { font-style: normal; color: #7f8da4; }

  .status { font-weight: 600; font-size: 11px; text-align: right; }
  .status--ok { color: #4ade80; }
  .status--warn { color: #fbbf24; }
  .status--error { color: #f87171; }
  .status--redirect { color: #7ba2ff; }

  .tag {
    display: inline-block;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .02em;
    background: #1f2836;
    color: #9fb0c9;
  }
  .tag--fragment { background: rgba(123, 162, 255, .16); color: #9db9ff; }
  .tag--vt { background: rgba(61, 220, 132, .14); color: #6ee7a8; }

  .list { display: flex; flex-direction: column; gap: 3px; }
  .list-item {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 12px;
  }
  .list-item:hover { background: #141a23; }

  .method {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .04em;
    padding: 1px 5px;
    border-radius: 4px;
    background: #1f2836;
    color: #9fb0c9;
    min-width: 46px;
    text-align: center;
  }
  .method--get { background: rgba(61, 220, 132, .12); color: #6ee7a8; }
  .method--post { background: rgba(123, 162, 255, .14); color: #9db9ff; }
  .method--put,
  .method--patch { background: rgba(251, 191, 36, .14); color: #fbbf24; }
  .method--delete { background: rgba(248, 113, 113, .14); color: #f87171; }

  .kv { display: grid; grid-template-columns: 118px 1fr; gap: 3px 10px; font-size: 12px; }
  .kv dt { color: #7f8da4; }
  .kv dd { margin: 0; word-break: break-word; }

  .section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: #6f7d94;
    margin: 14px 0 6px;
  }
  .section-title:first-child { margin-top: 2px; }

  details { border-radius: 6px; }
  details + details { margin-top: 6px; }
  details > summary {
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    font-size: 12px;
    color: #cfd7e5;
    list-style: none;
  }
  details > summary::-webkit-details-marker { display: none; }
  details > summary:hover { background: #141a23; }
  details > summary::before { content: "▸ "; color: #6f7d94; }
  details[open] > summary::before { content: "▾ "; }
  details pre {
    margin: 4px 0 8px;
    padding: 8px;
    background: #0a0d12;
    border: 1px solid #1b222c;
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #b7c3d6;
    max-height: 220px;
    overflow: auto;
  }

  .filters { display: flex; gap: 6px; margin-bottom: 8px; }
  .filters input {
    flex: 1;
    background: #141a23;
    border: 1px solid #232b39;
    border-radius: 6px;
    color: #dfe4ee;
    font: inherit;
    font-size: 12px;
    padding: 5px 8px;
  }
  .filters input:focus-visible { outline: 2px solid #7ba2ff; outline-offset: -1px; }

  .footer {
    display: flex;
    gap: 10px;
    padding: 6px 10px;
    border-top: 1px solid #232b39;
    background: #141a23;
    font-size: 11px;
    color: #6f7d94;
  }
  .footer span { white-space: nowrap; }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 20px;
    background: rgba(8, 10, 14, .78);
    backdrop-filter: blur(3px);
  }
  .overlay__card {
    width: min(720px, 100%);
    max-height: 84vh;
    overflow: auto;
    background: #12070a;
    border: 1px solid #4a1d25;
    border-left: 4px solid #d2354a;
    border-radius: 10px;
    padding: 16px 18px;
    box-shadow: 0 30px 80px -30px #000;
    color: #f3d9dd;
  }
  .overlay__title { margin: 0 0 4px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #ff8a9a; }
  .overlay__message { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: #fff; word-break: break-word; }
  .overlay__detail { margin: 0 0 10px; font-size: 12px; color: #d9a9b1; word-break: break-word; }
  .overlay pre {
    margin: 0 0 12px;
    padding: 10px;
    background: #0a0507;
    border: 1px solid #3a1620;
    border-radius: 8px;
    font-size: 11.5px;
    line-height: 1.5;
    color: #e8c4ca;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 40vh;
    overflow: auto;
  }
  .overlay__actions { display: flex; gap: 8px; }
  .overlay button {
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #5a2430;
    background: #2a1016;
    color: #ffd9df;
    cursor: pointer;
  }
  .overlay button:hover { background: #3a1620; }
  .overlay button:focus-visible { outline: 2px solid #ff8a9a; outline-offset: 2px; }
`;

let shadow;
let badgeEl;
let panelEl;
let contentEl;
let tabsEl;
let footerEl;
let overlayEl;
let refreshTimer = null;

function mount() {
  if (document.getElementById('flash-devtools')) return;

  const host = document.createElement('div');
  host.id = 'flash-devtools';
  host.setAttribute('data-position', config.position === 'bottom-left' ? 'bottom-left' : 'bottom-right');
  shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.append(style);

  badgeEl = h(
    'button',
    { class: 'badge', type: 'button', title: 'FLASH devtools', 'aria-label': 'Abrir FLASH devtools', onclick: toggle },
    h('span', { class: 'dot' }),
    'FLASH',
    h('span', { class: 'badge__count', hidden: true })
  );

  panelEl = h('section', {
    class: 'panel',
    hidden: true,
    role: 'dialog',
    'aria-label': 'FLASH devtools'
  });

  shadow.append(badgeEl, panelEl);
  document.documentElement.append(host);

  buildPanel();
  restore();
  applyOpenState();
  refresh();
}

function buildPanel() {
  const head = h(
    'header',
    { class: 'panel__head' },
    h('span', { class: 'panel__title' }, 'FLASH devtools'),
    h(
      'span',
      { class: 'panel__meta' },
      h('span', { class: 'live' }, 'dev'),
      h('span', { class: 'panel__version', text: '' })
    ),
    h('button', { class: 'icon-button', type: 'button', title: 'Recarregar', onclick: () => refresh(true) }, '⟳'),
    h('button', { class: 'icon-button', type: 'button', title: 'Fechar (Esc)', onclick: () => setOpen(false) }, '✕')
  );

  tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  contentEl = h('div', { class: 'content', role: 'tabpanel' });
  footerEl = h('footer', { class: 'footer' });

  panelEl.append(head, tabsEl, contentEl, footerEl);
  renderTabs();
}

const TABS = [
  { id: 'requests', label: 'Requisições' },
  { id: 'routes', label: 'Rotas' },
  { id: 'templates', label: 'Templates' },
  { id: 'page', label: 'Página' },
  { id: 'errors', label: 'Erros' }
];

function renderTabs() {
  tabsEl.replaceChildren(
    ...TABS.map((tab) => {
      const count =
        tab.id === 'errors' ? errorCount()
          : tab.id === 'routes' ? ui.stats?.routes?.length ?? 0
            : null;

      return h(
        'button',
        {
          class: 'tab',
          type: 'button',
          role: 'tab',
          'aria-selected': String(ui.tab === tab.id),
          onclick: () => {
            ui.tab = tab.id;
            persist();
            renderTabs();
            renderContent();
          }
        },
        tab.label,
        count ? h('span', { class: 'tab__count', text: String(count) }) : null
      );
    })
  );
}

function errorCount() {
  const serverErrors = (ui.stats?.requests ?? []).filter((entry) => entry.status >= 500).length;
  return ui.clientErrors.length + serverErrors;
}

function updateBadge() {
  if (!badgeEl) return;
  const count = errorCount();
  const counter = badgeEl.querySelector('.badge__count');
  counter.hidden = count === 0;
  counter.textContent = count > 99 ? '99+' : String(count);
  const dot = badgeEl.querySelector('.dot');
  dot.classList.toggle('dot--offline', ui.offline);
}

function applyOpenState() {
  if (!panelEl) return;
  panelEl.hidden = !ui.open;
  badgeEl.setAttribute('aria-expanded', String(ui.open));
  if (ui.open) {
    renderTabs();
    renderContent();
    startAutoRefresh();
    contentEl.querySelector('input')?.focus();
  } else {
    stopAutoRefresh();
  }
}

function toggle() {
  setOpen(!ui.open);
}

function setOpen(next) {
  ui.open = next;
  persist();
  applyOpenState();
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, 2500);
}

function stopAutoRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

/* ---------- data ---------- */

async function refresh(force = false) {
  try {
    const response = await fetch(STATS_URL, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ui.stats = await response.json();
    ui.offline = false;
  } catch (error) {
    ui.offline = true;
    if (force) recordError({ source: 'devtools', message: 'Servidor de desenvolvimento não respondeu', detail: String(error?.message ?? ''), fatal: false });
  }

  updateBadge();
  if (ui.open) {
    renderTabs();
    renderContent();
    renderFooter();
  }
}

async function action(name) {
  try {
    const response = await fetch(`${PREFIX}/actions/${name}`, { method: 'POST', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await refresh(true);
  } catch (error) {
    recordError({ source: 'devtools', message: `Ação "${name}" falhou`, detail: String(error?.message ?? ''), fatal: false });
  }
}

/* ---------- content ---------- */

function renderContent() {
  if (!contentEl) return;
  const scroll = contentEl.scrollTop;

  switch (ui.tab) {
    case 'routes': contentEl.replaceChildren(renderRoutes()); break;
    case 'templates': contentEl.replaceChildren(renderTemplates()); break;
    case 'page': contentEl.replaceChildren(renderPage()); break;
    case 'errors': contentEl.replaceChildren(renderErrors()); break;
    default: contentEl.replaceChildren(renderRequests()); break;
  }

  contentEl.scrollTop = scroll;
  renderFooter();
}

function renderRequests() {
  const requests = ui.stats?.requests ?? [];
  const filter = ui.filter.trim().toLowerCase();

  const matches = filter
    ? requests.filter((entry) => `${entry.method} ${entry.path} ${entry.status}`.toLowerCase().includes(filter))
    : requests;

  const search = h('input', {
    type: 'search',
    placeholder: 'Filtrar por caminho, método ou status',
    value: ui.filter,
    'aria-label': 'Filtrar requisições',
    oninput: (event) => {
      ui.filter = event.target.value;
      const focused = document.activeElement === event.target;
      renderContent();
      if (focused) contentEl.querySelector('input')?.focus();
    }
  });

  const header = h('div', { class: 'filters' }, search);

  if (matches.length === 0) {
    return h('div', {}, header, h('p', { class: 'empty', text: 'Nenhuma requisição registrada ainda.' }));
  }

  const rows = matches.map((entry) =>
    h(
      'div',
      { class: entry.status >= 500 ? 'row row--error' : 'row', title: `requestId: ${entry.id}` },
      h('span', { class: 'muted', text: timeOf(entry.at) }),
      h('span', { class: `method method--${entry.method.toLowerCase()}`, text: entry.method }),
      h(
        'span',
        { class: 'path' },
        entry.path,
        entry.fragment ? h('span', { class: 'tag tag--fragment', text: 'frag' }) : null,
        entry.transition ? h('span', { class: 'tag tag--vt', text: entry.transition }) : null
      ),
      h('span', { class: statusClass(entry.status), text: `${entry.status} · ${ms(entry.durationMs)}` })
    )
  );

  return h(
    'div',
    {},
    header,
    h('div', { class: 'section-title' }, `Últimas ${matches.length} de ${ui.stats?.counters?.requests ?? 0} requisições`),
    ...rows
  );
}

function renderRoutes() {
  const routes = ui.stats?.routes ?? [];

  if (routes.length === 0) {
    return h('p', { class: 'empty', text: 'Nenhuma rota registrada.' });
  }

  return h(
    'div',
    {},
    h('div', { class: 'section-title' }, `${routes.length} rotas registradas`),
    h(
      'div',
      { class: 'list' },
      ...routes.map((route) =>
        h(
          'div',
          { class: 'list-item' },
          h('span', { class: `method method--${route.method.toLowerCase()}`, text: route.method }),
          h('span', { class: 'mono', text: route.path })
        )
      )
    ),
    h('div', { class: 'section-title' }, 'Aplicação'),
    h(
      'dl',
      { class: 'kv' },
      h('dt', { text: 'middlewares' }), h('dd', { text: String(ui.stats?.app?.middlewares ?? 0) }),
      h('dt', { text: 'templates' }), h('dd', { text: String(ui.stats?.app?.templates ?? 0) }),
      h('dt', { text: 'strict' }), h('dd', { text: String(ui.stats?.app?.strict ?? false) }),
      h('dt', { text: 'transitions' }), h('dd', { text: String(ui.stats?.app?.transitions ?? false) }),
      h('dt', { text: 'node' }), h('dd', { text: String(ui.stats?.node ?? '') })
    )
  );
}

function renderTemplates() {
  const templates = ui.stats?.templates ?? [];

  if (templates.length === 0) {
    return h('p', { class: 'empty', text: 'Nenhum template compilado até agora. Navegue para popular o cache.' });
  }

  const viewCount = templates.filter((template) => template.kind === 'view').length;

  return h(
    'div',
    {},
    h('div', { class: 'section-title' }, `${viewCount} views · ${templates.length - viewCount} componentes em cache`),
    h(
      'div',
      { class: 'list' },
      ...templates.map((template) =>
        h(
          'div',
          { class: 'list-item', title: template.file },
          h('span', { class: template.kind === 'component' ? 'tag' : 'tag tag--fragment', text: template.kind }),
          h('span', { class: 'mono', text: template.name }),
          template.needsRuntime ? h('span', { class: 'tag tag--vt', text: 'runtime' }) : null
        )
      )
    ),
    h(
      'div',
      { class: 'filters', style: 'margin-top:10px' },
      h(
        'button',
        { class: 'icon-button', type: 'button', style: 'width:auto;padding:0 10px', onclick: () => action('clear-template-cache') },
        'limpar cache'
      )
    )
  );
}

function renderPage() {
  const stateSnapshot = {};
  for (const [key, value] of Object.entries(clientState)) {
    stateSnapshot[key] = value;
  }

  const directives = {};
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.attributes ?? []) {
      if (attribute.name.startsWith('f-')) {
        directives[attribute.name] = (directives[attribute.name] ?? 0) + 1;
      }
    }
  }

  return h(
    'div',
    {},
    h('div', { class: 'section-title' }, 'Página atual'),
    h(
      'dl',
      { class: 'kv' },
      h('dt', { text: 'url' }), h('dd', { class: 'mono', text: location.pathname + location.search }),
      h('dt', { text: 'data-vt' }), h('dd', { text: getPageTransition() ?? '(padrão: fade)' }),
      h('dt', { text: 'view transitions' }), h('dd', { text: supportsViewTransitions() ? 'suportado' : 'não suportado' }),
      h('dt', { text: 'reduced motion' }), h('dd', { text: prefersReducedMotion() ? 'sim' : 'não' }),
      h('dt', { text: 'nós no DOM' }), h('dd', { text: String(document.querySelectorAll('*').length) }),
      h('dt', { text: 'scripts' }), h('dd', { text: String(document.scripts.length) })
    ),

    h('div', { class: 'section-title' }, `Estado do cliente (${Object.keys(stateSnapshot).length} chaves)`),
    h(
      'details',
      { open: Object.keys(stateSnapshot).length <= 8 ? true : undefined },
      h('summary', { text: 'state' }),
      h('pre', { text: JSON.stringify(stateSnapshot, null, 2) ?? '{}' })
    ),

    h('div', { class: 'section-title' }, `Ações registradas (${registeredActions.size})`),
    registeredActions.size === 0
      ? h('p', { class: 'empty', text: 'Nenhuma ação. Use client({ actions }) na sua aplicação.' })
      : h(
          'div',
          { class: 'list' },
          ...[...registeredActions.keys()].map((name) =>
            h('div', { class: 'list-item' }, h('span', { class: 'mono', text: name }))
          )
        ),

    h('div', { class: 'section-title' }, `Diretivas nesta página (${Object.keys(directives).length})`),
    Object.keys(directives).length === 0
      ? h('p', { class: 'empty', text: 'Nenhuma diretiva f-* encontrada.' })
      : h(
          'div',
          { class: 'list' },
          ...Object.entries(directives).map(([name, count]) =>
            h('div', { class: 'list-item' }, h('span', { class: 'mono', text: name }), h('span', { class: 'muted', text: `×${count}` }))
          )
        )
  );
}

function renderErrors() {
  const serverErrors = (ui.stats?.requests ?? []).filter((entry) => entry.status >= 500);

  if (ui.clientErrors.length === 0 && serverErrors.length === 0) {
    return h('p', { class: 'empty', text: 'Nenhum erro capturado. 🎉' });
  }

  const blocks = [];

  if (serverErrors.length) {
    blocks.push(h('div', { class: 'section-title' }, 'Erros do servidor'));
    blocks.push(
      ...serverErrors.map((entry) =>
        h(
          'div',
          { class: 'list-item' },
          h('span', { class: `status ${statusClass(entry.status)}`, text: String(entry.status) }),
          h('span', { class: 'mono', text: `${entry.method} ${entry.path}` }),
          h('span', { class: 'muted', text: entry.id.slice(0, 8) })
        )
      )
    );
  }

  if (ui.clientErrors.length) {
    blocks.push(h('div', { class: 'section-title' }, `Erros do navegador (${ui.clientErrors.length})`));
    blocks.push(
      ...ui.clientErrors.map((entry) =>
        h(
          'details',
          {},
          h('summary', {}, h('span', { class: 'muted', text: `${timeOf(entry.at)} · ${entry.source} · ` }), entry.message),
          entry.detail ? h('pre', { text: String(entry.detail) }) : null,
          entry.stack ? h('pre', { text: String(entry.stack) }) : null
        )
      )
    );
    blocks.push(
      h(
        'div',
        { class: 'filters', style: 'margin-top:10px' },
        h(
          'button',
          { class: 'icon-button', type: 'button', style: 'width:auto;padding:0 10px', onclick: () => { ui.clientErrors.length = 0; updateBadge(); renderTabs(); renderContent(); } },
          'limpar'
        )
      )
    );
  }

  return h('div', {}, ...blocks);
}

function renderFooter() {
  if (!footerEl || !ui.stats) return;

  const { app, process: proc, counters } = ui.stats;

  footerEl.replaceChildren(
    h('span', { text: ui.offline ? 'offline' : `v${ui.stats.version}` }),
    h('span', { text: `${counters.requests} req` }),
    h('span', { text: `${app.routes} rotas` }),
    h('span', { text: `${app.templates} templates` }),
    h('span', { text: `${proc.heapMb} MB` }),
    h('span', { text: shortUptime(ui.stats.uptimeMs) })
  );
}

/* ---------- overlay ---------- */

function showOverlay(entry) {
  if (!shadow) return;
  if (overlayEl) overlayEl.remove();

  overlayEl = h(
    'div',
    { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'overlay__card' },
      h('p', { class: 'overlay__title', text: `Erro · ${entry.source ?? 'runtime'}` }),
      h('p', { class: 'overlay__message', text: entry.message ?? 'Erro não identificado' }),
      entry.detail ? h('p', { class: 'overlay__detail', text: String(entry.detail) }) : null,
      entry.stack ? h('pre', { text: String(entry.stack) }) : null,
      h(
        'div',
        { class: 'overlay__actions' },
        h('button', { type: 'button', onclick: dismissOverlay }, 'Fechar (Esc)'),
        h('button', { type: 'button', onclick: () => { dismissOverlay(); location.reload(); } }, 'Recarregar')
      )
    )
  );

  shadow.append(overlayEl);
  ui.overlayVisible = true;
  overlayEl.querySelector('button')?.focus();
}

function dismissOverlay() {
  overlayEl?.remove();
  overlayEl = null;
  ui.overlayVisible = false;
}

/* ---------- events ---------- */

function parseShortcut(value) {
  return String(value || SHORTCUT)
    .toLowerCase()
    .split('+')
    .map((part) => part.trim());
}

const shortcut = parseShortcut(config.shortcut);

function matchesShortcut(event) {
  return shortcut.every((part) => {
    if (part === 'alt') return event.altKey;
    if (part === 'shift') return event.shiftKey;
    if (part === 'ctrl' || part === 'control') return event.ctrlKey;
    if (part === 'meta') return event.metaKey;
    return event.key.toLowerCase() === part;
  });
}

document.addEventListener(
  'keydown',
  (event) => {
    if (matchesShortcut(event)) {
      event.preventDefault();
      toggle();
      return;
    }
    if (event.key === 'Escape') {
      if (overlayEl) {
        event.preventDefault();
        dismissOverlay();
      } else if (ui.open) {
        setOpen(false);
      }
    }
  },
  true
);

document.addEventListener('flash:update', () => {
  if (ui.open && ui.tab === 'page') renderContent();
});

/* ---------- boot ---------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

function boot() {
  mount();
  if (config.overlay !== false) installErrorHandlers();
  updateBadge();
}

if (typeof window !== 'undefined') {
  window.flashDevtools = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle,
    refresh,
    get snapshot() {
      return ui.stats;
    }
  };
}
