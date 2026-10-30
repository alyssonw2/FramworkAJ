/**
 * FLASH client runtime — declarative directives.
 *
 * Directive values are *client-side expressions* interpreted with the shared
 * restricted evaluator. Nothing is ever executed as code.
 *
 *   f-show="menu.open"                 toggles the `hidden` attribute
 *   f-model="search"                   binds a field to client state
 *   f-bind:disabled="saving"           reflects a value into an attribute/property
 *   f-class="active: tab === 'a'"      toggles classes
 *   f-on:click.prevent="menu.toggle"   runs a registered action
 *   f-confirm="Excluir?"               asks for confirmation
 *   f-submit="ajax" f-target="#lista"  enhances a form (see forms.js)
 *   f-transition="slide"               page transition used by the swap
 *   f-vt="'item-' + selected.id"       view-transition-name (shared element)
 *   f-morph="flash-card"               names the element when clicked, so the
 *                                      next page can morph into it
 */

import { evaluate, getPath, setPath, isPath } from './expressions.js';
import { setTransitionName } from './view-transitions.js';

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'checked', 'controls', 'defer',
  'disabled', 'formnovalidate', 'hidden', 'inert', 'loop', 'multiple', 'muted',
  'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed',
  'selected'
]);

const EVENT_ATTRIBUTE = /^f-on:([a-z][a-z0-9:-]*)((?:\.[a-z]+)*)$/i;
const LITERAL_NAME = /^[a-z][a-z0-9-]{0,59}$/;

function elementsOf(root) {
  if (!root) return [];
  if (root.nodeType === 1 && !root.querySelectorAll) return [root];
  const list = root.querySelectorAll ? root.querySelectorAll('*') : [];
  return list;
}

/**
 * Walks the subtree once and groups elements by the directives they use.
 * A single pass keeps updates cheap and predictable.
 */
export function collectDirectives(root) {
  const result = {
    show: [],
    model: [],
    classes: [],
    binds: [],
    transitions: [],
    events: new Set()
  };

  const visit = (element) => {
    const attributes = element.attributes;
    if (!attributes || attributes.length === 0) return;

    for (const attribute of attributes) {
      const name = attribute.name;

      if (name === 'f-show') result.show.push(element);
      else if (name === 'f-model') result.model.push(element);
      else if (name === 'f-class') result.classes.push(element);
      else if (name === 'f-vt') result.transitions.push(element);
      else if (name.startsWith('f-bind:')) result.binds.push(element);
      else {
        const match = EVENT_ATTRIBUTE.exec(name);
        if (match) result.events.add(match[1].toLowerCase());
      }
    }
  };

  if (root.nodeType === 1) visit(root);
  for (const element of elementsOf(root)) visit(element);

  return result;
}

function classPairs(source) {
  return String(source ?? '')
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const index = chunk.indexOf(':');
      if (index === -1) return { name: chunk, expression: null };
      return { name: chunk.slice(0, index).trim(), expression: chunk.slice(index + 1).trim() };
    });
}

function readInputValue(element) {
  const type = (element.getAttribute('type') ?? '').toLowerCase();

  if (type === 'checkbox') {
    const group = element.getAttribute('f-model-group');
    if (group) return { group, checked: element.checked, value: element.value };
    return element.checked;
  }

  if (type === 'radio') return element.checked ? element.value : undefined;
  if (element.tagName === 'SELECT' && element.multiple) {
    return [...element.selectedOptions].map((option) => option.value);
  }

  const raw = element.value;

  if (type === 'number' || type === 'range') {
    if (raw === '') return null;
    const number = Number(raw);
    return Number.isNaN(number) ? null : number;
  }

  return raw;
}

function writeModelValue(element, value) {
  const type = (element.getAttribute('type') ?? '').toLowerCase();

  if (type === 'checkbox') {
    const next = Boolean(value);
    if (element.checked !== next) element.checked = next;
    return;
  }

  if (type === 'radio') {
    const next = String(value ?? '') === element.value;
    if (element.checked !== next) element.checked = next;
    return;
  }

  const next = value === null || value === undefined ? '' : String(value);
  if (element.value !== next) element.value = next;
}

/**
 * Applies every directive in the subtree.
 *
 * @param {ParentNode|Element|Document} root
 * @param {{state: object, scope: object, onModel?: (path: string, value: unknown) => void}} context
 */
export function applyDirectives(root, context) {
  const { state, scope } = context;
  const targets = collectDirectives(root);

  for (const element of targets.show) {
    const value = evaluate(element.getAttribute('f-show'), scope, 'f-show');
    const hidden = !value;
    if (element.hidden !== hidden) element.hidden = hidden;
  }

  for (const element of targets.model) {
    const path = element.getAttribute('f-model');
    if (!isPath(path)) {
      console.warn(`[flash] f-model espera um caminho simples (ex.: "form.name"); recebido "${path}"`);
      continue;
    }
    writeModelValue(element, getPath(state, path));
    bindModelUpdater(element, path, context);
  }

  for (const element of targets.classes) {
    for (const pair of classPairs(element.getAttribute('f-class'))) {
      const active = pair.expression === null
        ? Boolean(getPath(state, pair.name))
        : Boolean(evaluate(pair.expression, scope, 'f-class'));
      element.classList.toggle(pair.name, active);
    }
  }

  for (const element of targets.transitions) {
    const raw = (element.getAttribute('f-vt') ?? '').trim();
    // A bare name (`f-vt="flash-card"`) is used literally; anything else is an
    // expression (`f-vt="'item-' + selected.id"`).
    const value = LITERAL_NAME.test(raw) ? raw : evaluate(raw, scope, 'f-vt');
    setTransitionName(element, typeof value === 'string' ? value : null);
  }

  for (const element of targets.binds) {
    for (const attribute of element.attributes) {
      if (!attribute.name.startsWith('f-bind:')) continue;
      const target = attribute.name.slice('f-bind:'.length);
      applyBind(element, target, evaluate(attribute.value, scope, attribute.name));
    }
  }
}

function applyBind(element, target, value) {
  const name = target.toLowerCase();

  if (name === 'value') {
    writeModelValue(element, value);
    return;
  }

  // Text is written through the property, never as HTML.
  if (name === 'textcontent') {
    const text = value === null || value === undefined ? '' : String(value);
    if (element.textContent !== text) element.textContent = text;
    return;
  }

  if (BOOLEAN_ATTRIBUTES.has(name)) {
    const enabled = Boolean(value);
    if (element.hasAttribute(name) !== enabled) element.toggleAttribute(name, enabled);
    if (name === 'disabled' && 'disabled' in element) element.disabled = enabled;
    if (name === 'checked' && 'checked' in element) element.checked = enabled;
    return;
  }

  if (value === false || value === null || value === undefined) {
    element.removeAttribute(target);
    return;
  }

  const text = String(value);
  if (element.getAttribute(target) !== text) element.setAttribute(target, text);
}

const modelBound = new WeakMap();

/** Makes a field write back into the client state on `input`/`change`. */
function bindModelUpdater(element, path, context) {
  const existing = modelBound.get(element);
  if (existing === path) return;

  const handler = () => {
    const value = readInputValue(element);
    if (value && typeof value === 'object' && 'group' in value) {
      const current = getPath(context.state, path);
      const list = Array.isArray(current) ? [...current] : [];
      const index = list.indexOf(value.value);
      if (value.checked && index === -1) list.push(value.value);
      if (!value.checked && index !== -1) list.splice(index, 1);
      setPath(context.state, path, list);
    } else if (value !== undefined) {
      setPath(context.state, path, value);
    }
    context.onModel?.(path, getPath(context.state, path));
  };

  element.addEventListener('input', handler);
  element.addEventListener('change', handler);
  modelBound.set(element, path);
}

/**
 * Returns the delegated actions found while walking from `start` up to the
 * document root, so one listener per event type is enough.
 */
export function findAction(start, type) {
  let node = start;

  while (node && node.nodeType === 1) {
    for (const attribute of node.attributes) {
      const match = EVENT_ATTRIBUTE.exec(attribute.name);
      if (match && match[1].toLowerCase() === type) {
        return { element: node, attribute, modifiers: match[2] };
      }
    }
    node = node.parentElement;
  }

  return null;
}

/** Nearest element (self or ancestor) carrying `f-confirm`. */
export function nearestConfirm(start) {
  let node = start;
  while (node && node.nodeType === 1) {
    const message = node.getAttribute('f-confirm');
    if (message) return { element: node, message };
    node = node.parentElement;
  }
  return null;
}

/** Nearest element (self or ancestor) carrying `f-morph`. */
export function nearestMorph(start) {
  let node = start;
  while (node && node.nodeType === 1) {
    const name = node.getAttribute?.('f-morph');
    if (name) return { element: node, name };
    node = node.parentElement;
  }
  return null;
}

export { BOOLEAN_ATTRIBUTES };
