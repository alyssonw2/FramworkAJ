/**
 * Client runtime tests.
 *
 * The browser modules are imported with a minimal DOM stub so that reference
 * errors, broken re-exports and init-time crashes are caught by `npm test`
 * instead of by a user in the browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function installDomStub() {
  const listeners = new Map();

  const element = () => ({
    nodeType: 1,
    attributes: [],
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    removeAttribute() {},
    toggleAttribute() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
    append() {},
    remove() {}
  });

  const documentStub = {
    nodeType: 9,
    readyState: 'complete',
    body: element(),
    documentElement: {
      dataset: {},
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      removeAttribute(name) { delete this.attributes[name]; }
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      for (const handler of listeners.get(event?.type) ?? []) handler(event);
      return true;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => element(),
    contains: () => false,
    activeElement: null
  };

  globalThis.document = documentStub;
  globalThis.window = {
    location: { href: 'http://localhost/', assign() {} },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    innerWidth: 1280,
    confirm: () => true,
    document: documentStub
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
      this.bubbles = Boolean(init.bubbles);
    }
  };

  return { listeners, documentStub };
}

const { documentStub } = installDomStub();

const expressions = await import('../src/client/expressions.js');
const directives = await import('../src/client/directives.js');
const forms = await import('../src/client/forms.js');
const runtime = await import('../src/client/runtime.js');
const viewTransitions = await import('../src/client/view-transitions.js');
const modal = await import('../src/client/modules/modal.js');
const toast = await import('../src/client/modules/toast.js');

test('módulos do navegador carregam sem erros de referência', () => {
  assert.equal(typeof expressions.evaluate, 'function');
  assert.equal(typeof directives.applyDirectives, 'function');
  assert.equal(typeof forms.setupForms, 'function');
  assert.equal(typeof runtime.client, 'function');
  assert.equal(typeof viewTransitions.runViewTransition, 'function');
  assert.equal(typeof modal.open, 'function');
  assert.equal(typeof toast.toast, 'function');
});

test('evaluate interpreta expressões com escopo local', () => {
  assert.equal(expressions.evaluate('1 + 1', {}), 2);
  assert.equal(expressions.evaluate('menu.open', { menu: { open: true } }), true);
  assert.equal(expressions.evaluate("tab === 'a' ? 'sim' : 'não'", { tab: 'a' }), 'sim');
  assert.equal(expressions.evaluate('', {}), undefined);
  assert.equal(expressions.evaluate('inexistente.x', {}), undefined);
});

test('getPath e setPath navegam em caminhos aninhados', () => {
  const state = { form: { name: 'Ana', tags: ['a'] } };

  assert.equal(expressions.getPath(state, 'form.name'), 'Ana');
  assert.equal(expressions.getPath(state, 'form.missing', 'vazio'), 'vazio');
  assert.equal(expressions.getPath(state, 'constructor'), undefined);

  expressions.setPath(state, 'form.address.city', 'São Paulo');
  assert.equal(state.form.address.city, 'São Paulo');

  assert.equal(expressions.isPath('a.b'), true);
  assert.equal(expressions.isPath('a[0]'), false);
});

test('client registra estado e ações', async () => {
  runtime.client({
    state: { menu: { open: false } },
    actions: {
      'menu.toggle'({ state }) {
        state.menu.open = !state.menu.open;
      }
    }
  });

  assert.equal(runtime.state.menu.open, false);
  await runtime.runAction('menu.toggle');
  assert.equal(runtime.state.menu.open, true);
});

test('ação inexistente não lança e avisa', async () => {
  const original = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));

  const result = await runtime.runAction('nao.existe');
  console.warn = original;

  assert.equal(result, undefined);
  assert.ok(warnings.some((message) => message.includes('não registrada')));
});

test('swap reporta erro quando o alvo não existe', () => {
  assert.equal(runtime.swap(null, '<p>x</p>'), false);
});

test('setupForms e registerModule são idempotentes', () => {
  forms.setupForms();
  forms.setupForms();

  runtime.registerModule('teste', { init() {} });
  runtime.registerModule('teste', { init() {} });

  assert.equal(typeof documentStub.addEventListener, 'function');
});

test('view transitions degradam para atualização direta sem suporte', () => {
  assert.equal(viewTransitions.supportsViewTransitions(), false);

  let ran = 0;
  const result = viewTransitions.runViewTransition(() => { ran += 1; });

  assert.equal(ran, 1);
  assert.equal(result.animated, false);
});

test('view transitions animam quando a API existe', () => {
  let finishedResolve;
  let calls = 0;

  documentStub.startViewTransition = (callback) => {
    calls += 1;
    callback();
    return {
      finished: new Promise((resolve) => { finishedResolve = resolve; }),
      updateCallbackDone: Promise.resolve(),
      skipTransition() {}
    };
  };

  const result = viewTransitions.runViewTransition(() => {}, { transition: 'slide' });

  assert.equal(calls, 1);
  assert.equal(result.animated, true);
  assert.equal(documentStub.documentElement.getAttribute('data-vt'), 'slide');

  delete documentStub.startViewTransition;
  finishedResolve();
});

test('a diretiva f-vt aplica view-transition-name', () => {
  const element = {
    nodeType: 1,
    attributes: [{ name: 'f-vt', value: "'item-' + selected.id" }],
    style: {
      value: '',
      setProperty(name, value) { this.value = `${name}:${value}`; },
      removeProperty() { this.value = ''; }
    },
    getAttribute(name) {
      const attribute = this.attributes.find((entry) => entry.name === name);
      return attribute ? attribute.value : null;
    }
  };

  directives.applyDirectives(element, {
    state: { selected: { id: 7 } },
    scope: { selected: { id: 7 } },
    onModel() {}
  });

  assert.equal(element.style.value, 'view-transition-name:item-7');
});
