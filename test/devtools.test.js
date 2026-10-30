import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlash, DevTools, DEVTOOLS_PANEL, DEVTOOLS_STATS } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function app(options = {}) {
  const flash = createFlash({
    views: path.join(HERE, 'fixtures', 'views'),
    components: [path.join(HERE, 'fixtures', 'components')],
    dev: true,
    ...options
  });

  flash.get('/doc', async (ctx) => ctx.render('document', { title: 'Doc', value: 1 }));
  flash.get('/frag', async (ctx) => ctx.fragment('simple', { title: 'F', value: 1 }, { target: '#r' }));
  flash.get('/boom', async () => {
    throw new Error('falha simulada');
  });

  return flash;
}

const request = (flash, init) => flash.handle({
  method: 'GET',
  path: '/doc',
  headers: { accept: 'text/html' },
  ...init
});

const stats = async (flash) => JSON.parse((await request(flash, { path: DEVTOOLS_STATS })).body);

test('dev: true injeta o painel na página', async () => {
  const flash = app();
  const response = await request(flash);

  assert.equal(response.status, 200);
  assert.match(response.body, /<script type="module" src="\/__flash\/dev\/panel\.js" data-flash-devtools/);
  assert.ok(response.body.indexOf('/__flash/dev/panel.js') < response.body.indexOf('</body>'));
  assert.equal(response.body.match(/__flash\/dev\/panel\.js/g).length, 1);
});

test('a configuração do painel viaja no atributo do script', async () => {
  const flash = app({ devtools: { position: 'bottom-left', overlay: false, shortcut: 'ctrl+shift+f' } });
  const response = await request(flash);

  const payload = /data-flash-devtools-config='([^']+)'/.exec(response.body)?.[1];
  assert.ok(payload, 'config ausente');
  assert.deepEqual(JSON.parse(payload), {
    position: 'bottom-left',
    overlay: false,
    shortcut: 'ctrl+shift+f'
  });
});

test('dev: false desliga painel e endpoints', async () => {
  const flash = app({ dev: false });

  const page = await request(flash);
  assert.ok(!page.body.includes('/__flash/dev/panel.js'));

  const statsResponse = await request(flash, { path: DEVTOOLS_STATS });
  assert.equal(statsResponse.status, 404);

  const panel = await request(flash, { path: DEVTOOLS_PANEL });
  assert.equal(panel.status, 404);
});

test('devtools: false mantém o modo dev sem painel', async () => {
  const flash = app({ devtools: false });

  const page = await request(flash);
  assert.ok(!page.body.includes('/__flash/dev/panel.js'), 'painel não deveria ser injetado');

  const statsResponse = await request(flash, { path: DEVTOOLS_STATS });
  assert.equal(statsResponse.status, 404);
});

test('fragmentos não recebem o painel', async () => {
  const flash = app();
  const response = await request(flash, { path: '/frag', headers: { 'x-flash-request': 'fragment' } });

  assert.equal(response.headers['X-Flash-Update'], 'replace');
  assert.ok(!response.body.includes('panel.js'));
});

test('stats.json devolve o snapshot do runtime', async () => {
  const flash = app();
  await request(flash);
  await request(flash, { path: '/frag', headers: { 'x-flash-request': 'fragment' } });

  const response = await request(flash, { path: DEVTOOLS_STATS });
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /application\/json/);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['X-Robots-Tag'], 'noindex');

  const data = JSON.parse(response.body);
  assert.equal(data.dev, true);
  assert.ok(data.process.rssMb > 0);
  assert.ok(data.uptimeMs >= 0);
  assert.equal(data.app.routes, 3);
  assert.equal(data.counters.fragments, 1);
  assert.ok(data.counters.requests >= 2);
  assert.ok(Array.isArray(data.routes));
  assert.ok(Array.isArray(data.templates));
  assert.equal(data.requests.length, data.counters.requestsLogged);
});

test('o log de requisições registra método, status, duração e fragmento', async () => {
  const flash = app();
  await request(flash);
  await request(flash, { path: '/frag', headers: { 'x-flash-request': 'fragment' } });

  const data = await stats(flash);
  const fragment = data.requests.find((entry) => entry.path === '/frag');

  assert.ok(fragment, 'fragmento não registrado');
  assert.equal(fragment.method, 'GET');
  assert.equal(fragment.fragment, true);
  assert.equal(fragment.status, 200);
  assert.ok(fragment.durationMs >= 0);
  assert.ok(fragment.bytes > 0);
  assert.match(fragment.id, /[0-9a-f-]{36}/);
});

test('requisições do próprio devtools não entram no log', async () => {
  const flash = app();
  await request(flash, { path: DEVTOOLS_STATS });
  await request(flash, { path: DEVTOOLS_STATS });

  const data = await stats(flash);
  assert.equal(data.requests.filter((entry) => entry.path.startsWith('/__flash/dev')).length, 0);
  assert.equal(data.counters.requests, 0);
});

test('erros do servidor aparecem no snapshot', async () => {
  const flash = app();
  await request(flash, { path: '/boom' });

  const data = await stats(flash);
  const failure = data.requests.find((entry) => entry.path === '/boom');

  assert.ok(failure);
  assert.equal(failure.status, 500);
  assert.equal(failure.error, true);
  assert.ok(data.counters.errors >= 1);
});

test('templates em cache expõem diretivas e componentes', async () => {
  const flash = app();
  await request(flash, { path: '/frag' });

  const data = await stats(flash);
  const template = data.templates.find((entry) => entry.name === 'simple');

  assert.ok(template, 'template não cacheado');
  assert.equal(template.kind, 'view');
  assert.ok(Array.isArray(template.directives));
});

test('ações de devtools limpam cache e log', async () => {
  const flash = app();
  await request(flash);

  assert.ok((await stats(flash)).templates.length > 0);

  const cleared = await request(flash, { method: 'POST', path: '/__flash/dev/actions/clear-template-cache' });
  assert.equal(cleared.status, 200);
  assert.deepEqual(JSON.parse(cleared.body), { ok: true, cleared: 'template-cache' });
  assert.equal((await stats(flash)).templates.length, 0);

  const clearedLog = await request(flash, { method: 'POST', path: '/__flash/dev/actions/clear-requests' });
  assert.equal(clearedLog.status, 200);

  const after = await stats(flash);
  assert.equal(after.requests.filter((entry) => !entry.path.startsWith('/__flash/dev')).length, 0);
});

test('ações exigem POST e nomes conhecidos', async () => {
  const flash = app();

  const getClear = await request(flash, { path: '/__flash/dev/actions/clear-template-cache' });
  assert.equal(getClear.status, 405);

  const unknown = await request(flash, { method: 'POST', path: '/__flash/dev/actions/apagar-tudo' });
  assert.equal(unknown.status, 404);
});

test('panel.js é servido como módulo JavaScript', async () => {
  const flash = app();
  const response = await request(flash, { path: DEVTOOLS_PANEL });

  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /text\/javascript/);
  assert.equal(response.headers['Cache-Control'], 'no-cache');
  assert.match(String(response.body), /flashDevtools/);
  assert.match(String(response.body), /attachShadow/);
});

test('o painel não é servido fora do modo dev', async () => {
  const flash = app({ dev: false });
  const response = await request(flash, { path: DEVTOOLS_PANEL });
  assert.equal(response.status, 404);
});

test('o log respeita o limite configurado', async () => {
  const flash = app({ devtools: { requestLog: 3 } });
  for (let i = 0; i < 6; i += 1) await request(flash, { path: '/doc' });

  const data = await stats(flash);
  assert.equal(data.requests.length, 3);
  assert.equal(data.counters.requests, 6);
  assert.equal(data.options.requestLog, 3);
});

test('DevTools pode ser usado isoladamente', async () => {
  const flash = app({ devtools: false });
  const devtools = new DevTools(flash, { requestLog: 2, position: 'bottom-left' });

  assert.equal(devtools.options.position, 'bottom-left');
  assert.equal(devtools.panelSource, DEVTOOLS_PANEL);

  const response = devtools.inject({
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: '<html><body><p>x</p></body></html>'
  });

  assert.match(response.body, /data-flash-devtools/);
  assert.equal(response.body.match(/panel\.js/g).length, 1);

  const again = devtools.inject(response);
  assert.equal(again.body.match(/panel\.js/g).length, 1, 'não deve duplicar');
});

test('a injeção ignora respostas que não são HTML completo', () => {
  const flash = app({ devtools: false });
  const devtools = new DevTools(flash);

  for (const body of ['<div>trecho</div>', '{"json":true}', '']) {
    const response = devtools.inject({ status: 200, headers: {}, body });
    assert.equal(response.body, body);
  }

  const json = devtools.inject({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: '<html><body></body></html>'
  });
  assert.ok(!json.body.includes('panel.js'));
});
