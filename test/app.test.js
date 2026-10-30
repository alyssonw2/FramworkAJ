import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlash } from '../src/index.js';
import { HttpError, ValidationError } from '../src/core/errors.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function app(options = {}) {
  return createFlash({
    views: path.join(HERE, 'fixtures', 'views'),
    components: [path.join(HERE, 'fixtures', 'components')],
    dev: true,
    ...options
  });
}

const request = (flash, init) => flash.handle({
  method: 'GET',
  path: '/',
  headers: { accept: 'text/html' },
  ...init
});

test('renderiza rota com props e cabeçalho de conteúdo', async () => {
  const flash = app();
  flash.get('/hello', async (ctx) => ctx.render('simple', { title: 'Oi', value: 42 }));

  const response = await request(flash, { path: '/hello' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(response.body, /<h1>Oi<\/h1>/);
  assert.match(response.body, /<p class="value">42<\/p>/);
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(response.headers['X-Request-Id']);
});

test('middleware roda em ordem e pode interromper', async () => {
  const flash = app();
  const calls = [];

  flash.use(async (ctx) => {
    calls.push('first');
    ctx.user = { id: 1 };
    return undefined;
  });
  flash.use(async (ctx) => {
    calls.push('second');
    if (ctx.path === '/blocked') return ctx.html('bloqueado', { status: 403 });
    return undefined;
  });
  flash.get('/ok', async (ctx) => {
    calls.push('handler');
    return ctx.html(`user=${ctx.user.id}`);
  });

  const ok = await request(flash, { path: '/ok' });
  assert.equal(ok.body, 'user=1');
  assert.deepEqual(calls, ['first', 'second', 'handler']);

  const blocked = await request(flash, { path: '/blocked' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body, 'bloqueado');
});

test('ctx expõe params, query, body e helpers de entrada', async () => {
  const flash = app();
  flash.post('/items/:id', async (ctx) => ctx.json({
    id: ctx.params.id,
    q: ctx.query.q,
    name: ctx.string('name'),
    price: ctx.number('price'),
    active: ctx.boolean('active'),
    tags: ctx.input('tags')
  }));

  const response = await request(flash, {
    method: 'POST',
    path: '/items/7?q=termo',
    body: { name: '  Ana  ', price: '19.9', active: 'on', tags: ['a', 'b'] }
  });

  assert.deepEqual(JSON.parse(response.body), {
    id: '7',
    q: 'termo',
    name: 'Ana',
    price: 19.9,
    active: true,
    tags: ['a', 'b']
  });
});

test('404 renderiza o template de erro quando existe', async () => {
  const flash = app();
  const response = await request(flash, { path: '/nao-existe' });

  assert.equal(response.status, 404);
  assert.match(response.body, /data-status="404"/);
  assert.match(response.body, /Rota não encontrada/);
  assert.ok(response.body.includes(response.headers['X-Request-Id']));
});

test('405 informa os métodos permitidos', async () => {
  const flash = app();
  flash.get('/only-get', async (ctx) => ctx.html('ok'));

  const response = await request(flash, { method: 'POST', path: '/only-get' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, 'GET');
});

test('HttpError respeita status, mensagem e expose', async () => {
  const flash = app();
  flash.get('/teapot', async () => {
    throw new HttpError(418, 'sou um bule', { headers: { 'X-Custom': '1' } });
  });
  flash.get('/crash', async () => {
    throw new Error('segredo interno');
  });

  const teapot = await request(flash, { path: '/teapot' });
  assert.equal(teapot.status, 418);
  assert.equal(teapot.headers['X-Custom'], '1');
  assert.match(teapot.body, /sou um bule/);

  const crash = await request(flash, { path: '/crash' });
  assert.equal(crash.status, 500);
  assert.match(crash.body, /Erro interno do servidor/);
  assert.ok(!crash.body.includes('segredo interno'), 'não deve vazar detalhes');
});

test('ValidationError leva os erros para o template', async () => {
  const flash = app();
  flash.post('/valid', async () => {
    throw new ValidationError({ name: 'obrigatório' });
  });

  const response = await request(flash, { method: 'POST', path: '/valid', body: {} });
  assert.equal(response.status, 422);
  assert.match(response.body, /data-status="422"/);
});

test('redirect padrão é 303; requisições de fragmento recebem X-Flash-Redirect', async () => {
  const flash = app();
  flash.post('/save', async (ctx) => ctx.redirect('/done'));

  const classic = await request(flash, { method: 'POST', path: '/save', body: {} });
  assert.equal(classic.status, 303);
  assert.equal(classic.headers.Location, '/done');

  const fragment = await request(flash, {
    method: 'POST',
    path: '/save',
    body: {},
    headers: { 'x-flash-request': 'fragment' }
  });
  assert.equal(fragment.status, 200);
  assert.equal(fragment.headers['X-Flash-Redirect'], '/done');
});

test('ctx.fragment declara estratégia de atualização', async () => {
  const flash = app();
  flash.get('/lista', async (ctx) => ctx.fragment('simple', { title: 'a', value: 1 }, { target: '#lista' }));

  const response = await request(flash, { path: '/lista', headers: { 'x-flash-request': 'fragment' } });
  assert.equal(response.headers['X-Flash-Update'], 'replace');
  assert.equal(response.headers['X-Flash-Target'], '#lista');
  assert.match(response.body, /<h1>a<\/h1>/);
});

test('erros retornam fragmento para requisições de fragmento', async () => {
  const flash = app();
  flash.post('/boom', async () => {
    throw new HttpError(409, 'conflito');
  });

  const response = await request(flash, {
    method: 'POST',
    path: '/boom',
    headers: { 'x-flash-request': 'fragment' }
  });
  assert.equal(response.status, 409);
  assert.equal(response.headers['X-Flash-Update'], 'replace');
  assert.match(response.body, /flash-error/);
});

test('locals são mesclados em toda renderização', async () => {
  const flash = app();
  flash.use(async (ctx) => {
    ctx.locals.title = 'do middleware';
    ctx.csrfToken = 'token-123';
    return undefined;
  });
  flash.get('/locals', async (ctx) => ctx.render('simple', { value: 1 }));

  const response = await request(flash, { path: '/locals' });
  assert.match(response.body, /<h1>do middleware<\/h1>/);
});

test('ctx.defer roda depois do handler', async () => {
  const flash = app();
  flash.use(async (ctx) => {
    ctx.defer((response) => {
      response.headers['X-Deferred'] = 'yes';
    });
    return undefined;
  });
  flash.get('/defer', async (ctx) => ctx.html('ok'));

  const response = await request(flash, { path: '/defer' });
  assert.equal(response.headers['X-Deferred'], 'yes');
});

test('handler sem resposta gera 500 explícito', async () => {
  const flash = app();
  flash.get('/nada', async () => undefined);

  const response = await request(flash, { path: '/nada' });
  assert.equal(response.status, 500);
});

test('rota inexistente sem views usa página mínima', async () => {
  const flash = createFlash({ dev: false });
  const response = await request(flash, { path: '/x' });
  assert.equal(response.status, 404);
  assert.match(response.body, /<!doctype html>/);
});

test('produção não expõe stack trace', async () => {
  const flash = createFlash({
    views: path.join(HERE, 'fixtures', 'views'),
    dev: false
  });
  flash.get('/boom', async () => {
    throw new Error('detalhe secreto');
  });

  const response = await request(flash, { path: '/boom' });
  assert.equal(response.status, 500);
  assert.ok(!response.body.includes('detalhe secreto'));
});

test('serve o runtime e responde 304 com ETag', async () => {
  const flash = app();

  const first = await request(flash, { path: '/__flash/client/runtime.js' });
  assert.equal(first.status, 200);
  assert.equal(first.headers['Content-Type'], 'text/javascript; charset=utf-8');
  assert.ok(first.body.length > 0);

  const cached = await request(flash, {
    path: '/__flash/client/runtime.js',
    headers: { 'if-none-match': first.headers.ETag }
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.body, null);
});

test('bloqueia travessia de diretório em assets', async () => {
  const flash = app();
  const response = await request(flash, { path: '/__flash/client/../../package.json' });
  assert.equal(response.status, 404);
});

test('assets públicos respeitam prefixo', async () => {
  const flash = app({ publicDir: path.join(HERE, 'fixtures'), publicPrefix: '/assets' });
  const response = await request(flash, { path: '/assets/views/simple.html' });
  assert.equal(response.status, 200);
  assert.match(String(response.body), /<h1>/);
});

test('METHOD HEAD devolve cabeçalhos sem corpo', async () => {
  const flash = app();
  flash.get('/head', async (ctx) => ctx.html('conteúdo'));

  const response = await request(flash, { method: 'HEAD', path: '/head' });
  assert.equal(response.status, 200);
  assert.equal(response.body, 'conteúdo');
  assert.equal(response.headers['Content-Length'], String(Buffer.byteLength('conteúdo')));
});

test('helps de JSON e texto', async () => {
  const flash = app();
  flash.get('/json', async (ctx) => ctx.json({ ok: true }));
  flash.get('/text', async (ctx) => ctx.text('oi'));

  const json = await request(flash, { path: '/json' });
  assert.equal(json.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(json.body), { ok: true });

  const text = await request(flash, { path: '/text' });
  assert.equal(text.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(text.body, 'oi');
});
