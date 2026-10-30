import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseExpression,
  evaluateExpression,
  clearExpressionCache,
  ExpressionError,
  EXPRESSION_LIMITS
} from '../src/shared/expression.js';

const evalExpr = (source, scope = {}, options) => evaluateExpression(source, scope, options);

test('literais e operadores básicos', () => {
  assert.equal(evalExpr('1 + 2 * 3'), 7);
  assert.equal(evalExpr('(1 + 2) * 3'), 9);
  assert.equal(evalExpr("'a' + 'b'"), 'ab');
  assert.equal(evalExpr('"a" + 1'), 'a1');
  assert.equal(evalExpr('10 / 4'), 2.5);
  assert.equal(evalExpr('10 % 3'), 1);
  assert.equal(evalExpr('-5'), -5);
  assert.equal(evalExpr('!false'), true);
  assert.equal(evalExpr('true && false'), false);
  assert.equal(evalExpr('null'), null);
  assert.equal(evalExpr('undefined'), undefined);
});

test('precedência de comparações e lógica', () => {
  assert.equal(evalExpr('1 + 1 === 2'), true);
  assert.equal(evalExpr('2 < 3 && 3 < 4'), true);
  assert.equal(evalExpr('false || 1 === 1'), true);
  assert.equal(evalExpr("'a' !== 'b'"), true);
  assert.equal(evalExpr('1 == "1"'), true);
  assert.equal(evalExpr('1 === "1"'), false);
});

test('ternário', () => {
  assert.equal(evalExpr("true ? 'sim' : 'não'"), 'sim');
  assert.equal(evalExpr("false ? 'sim' : 'não'"), 'não');
  assert.equal(evalExpr("1 > 2 ? 'a' : 3 > 2 ? 'b' : 'c'"), 'b');
});

test('acesso a propriedades e índices', () => {
  const scope = { user: { name: 'Ana', tags: ['a', 'b'] }, list: [10, 20] };
  assert.equal(evalExpr('user.name', scope), 'Ana');
  assert.equal(evalExpr('user.tags[1]', scope), 'b');
  assert.equal(evalExpr('list[0] + list[1]', scope), 30);
  assert.equal(evalExpr('user.tags.length', scope), 2);
  assert.equal(evalExpr('"texto".length'), 5);
});

test('propriedade ausente resolve para undefined no modo padrão', () => {
  assert.equal(evalExpr('user.nickname', { user: { name: 'Ana' } }), undefined);
});

test('identificador desconhecido lança erro em modo estrito', () => {
  assert.throws(() => evalExpr('missing', {}, { strict: true }), ExpressionError);
  assert.equal(evalExpr('missing', {}, { strict: false }), undefined);
});

test('ler membro de null lança erro em modo estrito', () => {
  assert.throws(() => evalExpr('user.name', { user: null }, { strict: true }), /Cannot read "name"/);
  assert.equal(evalExpr('user.name', { user: null }, { strict: false }), undefined);
});

test('modo full também valida propriedades inexistentes', () => {
  assert.throws(() => evalExpr('user.nickname', { user: { name: 'Ana' } }, { strict: 'full' }), /does not exist/);
});

test('bloqueia acesso ao protótipo e construtor', () => {
  for (const source of ['a.__proto__', 'a.constructor', 'a.prototype', 'constructor']) {
    assert.throws(() => evalExpr(source, { a: {} }, { strict: false }), ExpressionError, source);
  }
});

test('não expõe métodos de array, string ou objeto', () => {
  const scope = { list: [1, 2, 3], text: 'abc', obj: { a: 1 } };
  assert.equal(evalExpr('list.map', scope), undefined);
  assert.equal(evalExpr('text.toUpperCase', scope), undefined);
  assert.equal(evalExpr('obj.hasOwnProperty', scope), undefined);
  assert.throws(() => evalExpr('list.constructor', scope), ExpressionError);
});

test('não há acesso a globais', () => {
  for (const source of ['process', 'globalThis', 'window', 'document', 'require']) {
    assert.throws(() => evalExpr(source, {}, { strict: true }), ExpressionError, source);
  }
});

test('chamadas só funcionam para helpers registrados', () => {
  const helpers = { double: (n) => n * 2 };
  assert.equal(evalExpr('double(21)', {}, { helpers }), 42);
  assert.throws(() => evalExpr('eval("1")'), /not a registered helper/);
  assert.throws(() => evalExpr('alert(1)'), /not a registered helper/);
  assert.throws(() => evalExpr('user.name()', { user: { name: 'x' } }), /Only helpers/);
});

test('limites de tamanho e complexidade', () => {
  const tooLong = 'a'.repeat(EXPRESSION_LIMITS.maxLength + 1);
  assert.throws(() => parseExpression(tooLong), /exceeds/);

  const deep = `${'('.repeat(40)}1${')'.repeat(40)}`;
  assert.throws(() => parseExpression(deep), ExpressionError);

  assert.throws(() => parseExpression(''), /Empty expression/);
});

test('erros de sintaxe apontam a posição', () => {
  try {
    parseExpression('user.name +');
    assert.fail('deveria falhar');
  } catch (error) {
    assert.ok(error instanceof ExpressionError);
    assert.match(error.message, /Unexpected end of expression/);
  }
});

test('cache de AST devolve o mesmo nó', () => {
  clearExpressionCache();
  const a = parseExpression('a.b + 1');
  const b = parseExpression('a.b + 1');
  assert.equal(a, b);
});

test('strings com escapes e aspas', () => {
  assert.equal(evalExpr("'it\\'s'"), "it's");
  assert.equal(evalExpr('"a\\nb"'), 'a\nb');
});
