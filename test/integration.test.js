import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { createFlash } from '../src/index.js';
import { expressAdapter } from '../src/adapters/express.js';
import { session } from '../src/adapters/session.js';
import { csrf } from '../src/adapters/csrf.js';
import { securityHeaders } from '../src/adapters/security.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function createTestServer() {
  const flash = createFlash({
    views: path.join(HERE, 'fixtures', 'views'),
    components: [path.join(HERE, 'fixtures', 'components')],
    dev: true
  });

  const items = [];
  const view = () => ({ title: 'Itens', name: '', items: [...items] });

  flash.use(securityHeaders());
  flash.use(session({ secret: 'integration-secret' }));
  flash.use(csrf());

  flash.get('/items', async (ctx) => ctx.render('form', view()));

  flash.post('/items', async (ctx) => {
    const name = ctx.string('name');
    if (name === '') {
      return ctx.render('form', { ...view(), error: 'Informe um nome' }, { status: 422 });
    }
    items.push(name);

    if (ctx.wantsFragment()) return ctx.fragment('form', view());
    return ctx.redirect('/items');
  });

  flash.get('/boom', async () => {
    throw new Error('falha controlada');
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(expressAdapter(flash, { bodyLimit: '64kb' }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, items });
    });
  });
}

class Browser {
  constructor(base) {
    this.base = base;
    this.jar = new Map();
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      this.jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  cookieHeader() {
    return [...this.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async get(pathname, headers = {}) {
    const response = await fetch(this.base + pathname, {
      headers: { cookie: this.cookieHeader(), ...headers },
      redirect: 'manual'
    });
    this.absorb(response);
    return response;
  }

  async post(pathname, body, headers = {}) {
    const response = await fetch(this.base + pathname, {
      method: 'POST',
      headers: {
        cookie: this.cookieHeader(),
        'content-type': 'application/x-www-form-urlencoded',
        ...headers
      },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual'
    });
    this.absorb(response);
    return response;
  }

  async token(pathname = '/items') {
    const response = await this.get(pathname);
    const html = await response.text();
    return /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
  }
}

test('Express: SSR entrega HTML com formulário, CSRF e atributos de aprimoramento', async (t) => {
  const { server, url } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  const response = await browser.get('/items');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(html, /<h1>Itens<\/h1>/);
  assert.match(html, /name="_csrf" value="[^"]+"/);
  assert.match(html, /f-submit="ajax"/);
  assert.match(html, /f-target="#list"/);
  assert.ok(browser.jar.size > 0, 'a sessão deve criar cookie');
});

test('Express: POST tradicional responde 303', async (t) => {
  const { server, url, items } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  const token = await browser.token();
  assert.ok(token);

  const response = await browser.post('/items', { name: 'Novo', _csrf: token });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/items');
  assert.deepEqual(items, ['Novo']);
});

test('Express: POST inválido devolve 422 com o formulário', async (t) => {
  const { server, url, items } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  const token = await browser.token();

  const response = await browser.post('/items', { name: '', _csrf: token });
  assert.equal(response.status, 422);
  assert.match(await response.text(), /<h1>Itens<\/h1>/);
  assert.deepEqual(items, []);
});

test('Express: POST sem CSRF é recusado', async (t) => {
  const { server, url } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  await browser.get('/items');

  const response = await browser.post('/items', { name: 'Sem token' });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /Token CSRF/);
});

test('Express: requisição de fragmento devolve apenas o trecho', async (t) => {
  const { server, url } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  const token = await browser.token();

  const response = await browser.post(
    '/items',
    { name: 'Fragmento', _csrf: token },
    { 'x-flash-request': 'fragment' }
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-flash-update'), 'replace');
  assert.ok(!html.includes('<html'), 'o fragmento não deve conter o documento');
  assert.match(html, /<li>Fragmento<\/li>/);
});

test('Express: erro 500 não vaza detalhes e mantém request id', async (t) => {
  const { server, url } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  const response = await browser.get('/boom');
  const html = await response.text();

  assert.equal(response.status, 500);
  assert.ok(!html.includes('falha controlada'));
  assert.ok(response.headers.get('x-request-id'));
});

test('Express: 404 usa a página de erro do projeto', async (t) => {
  const { server, url } = await createTestServer();
  t.after(() => server.close());

  const browser = new Browser(url);
  const response = await browser.get('/nao-existe');
  assert.equal(response.status, 404);
  assert.match(await response.text(), /data-status="404"/);
});

test('Express: assets do framework têm cache e tipo corretos', async (t) => {
  const { server, url } = await createTestServer();
  t.after(() => server.close());

  const assets = [
    ['/__flash/client/runtime.js', 'text/javascript'],
    ['/__flash/client/directives.js', 'text/javascript'],
    ['/__flash/client/forms.js', 'text/javascript'],
    ['/__flash/shared/expression.js', 'text/javascript'],
    ['/__flash/ui/flash.css', 'text/css']
  ];

  for (const [asset, type] of assets) {
    const response = await fetch(url + asset);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type'), new RegExp(type), asset);
    assert.ok((await response.text()).length > 0, asset);
  }
});
