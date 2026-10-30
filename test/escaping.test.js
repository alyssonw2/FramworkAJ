import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  escapeAttribute,
  safeHtml,
  isSafeHtml,
  SafeHtml,
  toText,
  safeUrl,
  trustedFragment
} from '../src/shared/escaping.js';

test('escapa os caracteres perigosos', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeAttribute('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
  assert.equal(escapeHtml("' OR 1=1 --"), '&#39; OR 1=1 --');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('`cmd`'), '&#96;cmd&#96;');
});

test('valores vazios viram string vazia', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
});

test('números e booleanos são convertidos', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml(12.5), '12.5');
});

test('objetos e arrays viram JSON (e o JSON é escapado)', () => {
  assert.equal(toText([1, 2]), '[1,2]');
  assert.equal(toText({ a: 1 }), '{"a":1}');
  assert.equal(escapeHtml({ a: 1 }), '{&quot;a&quot;:1}');
});

test('datas usam ISO 8601', () => {
  assert.equal(escapeHtml(new Date('2024-01-02T03:04:05.000Z')), '2024-01-02T03:04:05.000Z');
});

test('funções não podem ser impressas', () => {
  assert.throws(() => toText(() => {}), TypeError);
  assert.throws(() => toText(Symbol('x')), TypeError);
});

test('SafeHtml não é escapado', () => {
  const value = safeHtml('<b>ok</b>');
  assert.ok(value instanceof SafeHtml);
  assert.ok(isSafeHtml(value));
  assert.equal(escapeHtml(value), '<b>ok</b>');
  assert.equal(String(value), '<b>ok</b>');
  assert.equal(isSafeHtml('<b>ok</b>'), false);
});

test('trustedFragment marca fragmentos renderizados', () => {
  const fragment = trustedFragment('<p>ok</p>');
  assert.ok(isSafeHtml(fragment));
  assert.equal(escapeHtml(fragment), '<p>ok</p>');
});

test('safeUrl bloqueia esquemas perigosos', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), '#');
  assert.equal(safeUrl('java\nscript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html;base64,PHNjcmlwdD4='), '#');
  assert.equal(safeUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeUrl('/clients/1'), '/clients/1');
  assert.equal(safeUrl('https://example.com'), 'https://example.com');
});
