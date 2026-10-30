import test from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../src/core/router.js';

test('rota estática', () => {
  const router = new Router();
  const handler = () => 'ok';
  router.add('GET', '/clients', [handler]);

  const match = router.match('GET', '/clients');
  assert.deepEqual({ ...match.params }, {});
  assert.deepEqual(match.handlers, [handler]);
  assert.equal(router.match('POST', '/clients').allowed[0], 'GET');
  assert.equal(router.match('GET', '/clientes'), null);
});

test('parâmetros nomeados', () => {
  const router = new Router();
  router.add('GET', '/clients/:id/edit', [() => {}]);

  const match = router.match('GET', '/clients/42/edit');
  assert.equal(match.params.id, '42');
  assert.equal(router.match('GET', '/clients/42'), null);
});

test('parâmetros decodificados', () => {
  const router = new Router();
  router.add('GET', '/busca/:termo', [() => {}]);
  assert.equal(router.match('GET', '/busca/jo%C3%A3o').params.termo, 'joão');
});

test('curinga final', () => {
  const router = new Router();
  router.add('GET', '/files/*', [() => {}]);
  assert.equal(router.match('GET', '/files/a/b/c.txt').params['*'], 'a/b/c.txt');
});

test('barra final e método curinga', () => {
  const router = new Router();
  router.add('*', '/qualquer', [() => {}]);
  assert.ok(router.match('PATCH', '/qualquer'));
  assert.ok(router.match('GET', '/qualquer/'));
});

test('métodos permitidos para 405', () => {
  const router = new Router();
  router.add('GET', '/clients', [() => {}]);
  router.add('POST', '/clients', [() => {}]);

  const match = router.match('DELETE', '/clients');
  assert.deepEqual(match.allowed.sort(), ['GET', 'POST']);
});

test('rejeita definições inválidas', () => {
  const router = new Router();
  assert.throws(() => router.add('GET', '/x', []), /no handler/);
  assert.throws(() => router.add('GET', '/x', ['nope']), /non-function/);
  assert.throws(() => router.add('GET', '/x/:1bad', [() => {}]), /Invalid route parameter/);
});

test('list devolve as rotas registradas', () => {
  const router = new Router();
  router.add('GET', '/a', [() => {}]);
  router.add('POST', '/b', [() => {}]);
  assert.deepEqual(router.list(), [
    { method: 'GET', path: '/a' },
    { method: 'POST', path: '/b' }
  ]);
});
