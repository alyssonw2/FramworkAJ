import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlash } from '../src/index.js';
import {
  applyPageTransition,
  injectTransitionAssets
} from '../src/view/transitions.js';
import { isTransitionName, vtName, PAGE_TRANSITIONS } from '../src/shared/transition-names.js';
import { evaluateExpression } from '../src/shared/expression.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = '<!doctype html>\n<html lang="pt-BR">\n<head><title>t</title></head>\n<body><p>x</p></body>\n</html>';

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

/* ---------- utilitários ---------- */

test('injectTransitionAssets adiciona o link uma única vez', () => {
  const href = '/__flash/ui/view-transitions.css';

  const first = injectTransitionAssets(DOC, href);
  assert.equal(first.injected, true);
  assert.match(first.html, /<link rel="stylesheet" href="\/__flash\/ui\/view-transitions\.css" data-flash-transitions>\n<\/head>/);

  const second = injectTransitionAssets(first.html, href);
  assert.equal(second.injected, false);
  assert.equal(second.html, first.html);
});

test('mencionar o caminho do CSS no conteúdo não impede a injeção', async () => {
  const flash = app();
  flash.get('/doc', async (ctx) => ctx.render('document-mention', { title: 'Docs', value: 1 }));

  const response = await request(flash, { path: '/doc' });
  assert.equal(response.body.match(/<link[^>]*view-transitions\.css/g).length, 1);
  assert.match(response.body, /<link rel="stylesheet" href="\/__flash\/ui\/view-transitions\.css" data-flash-transitions>/);
});

test('injectTransitionAssets ignora documentos parciais', () => {
  const href = '/x.css';
  for (const html of ['<div>trecho</div>', '', '<html><body>sem head</body></html>']) {
    const result = injectTransitionAssets(html, href);
    assert.equal(result.injected, false);
    assert.equal(result.html, html);
  }
});

test('applyPageTransition escreve e substitui data-vt', () => {
  const added = applyPageTransition(DOC, 'slide');
  assert.match(added, /<html data-vt="slide" lang="pt-BR">/);

  const replaced = applyPageTransition(added, 'curtain');
  assert.match(replaced, /<html data-vt="curtain" lang="pt-BR">/);
  assert.equal(replaced.match(/data-vt=/g).length, 1);
});

test('applyPageTransition respeita nomes inválidos', () => {
  assert.equal(applyPageTransition(DOC, '"><script>'), DOC);
  assert.equal(applyPageTransition(DOC, null), DOC);
  assert.equal(applyPageTransition(DOC, ''), DOC);
});

test('isTransitionName valida os nomes publicados', () => {
  for (const name of PAGE_TRANSITIONS) assert.equal(isTransitionName(name), true, name);
  assert.equal(isTransitionName('Slide'), false);
  assert.equal(isTransitionName('9slide'), false);
  assert.equal(isTransitionName('a b'), false);
});

test('vtName gera nomes CSS-safe e únicos', () => {
  assert.equal(vtName('client', '3F2A-9c'), 'flash-client-3f2a-9c');
  assert.equal(vtName('card', 42), 'flash-card-42');
  assert.equal(vtName('hero'), 'flash-hero');
  assert.equal(vtName('', ''), 'flash-vt');
  assert.notEqual(vtName('card', 'a b'), vtName('card', 'aB'));
  assert.match(vtName('x', '1'.repeat(200)), /^flash-x-1+$/);
  assert.ok(vtName('x', '1'.repeat(200)).length <= 60);
});

test('vtName está disponível como helper de template', () => {
  assert.equal(evaluateExpression("vtName('client', 7)"), 'flash-client-7');
});

/* ---------- integração com o servidor ---------- */

test('HTML completo recebe o stylesheet de transições por padrão', async () => {
  const flash = app();
  flash.get('/doc', async (ctx) => ctx.render('document', { title: 'Doc', value: 1 }));

  const response = await request(flash, { path: '/doc' });
  assert.equal(response.status, 200);
  assert.match(response.body, /<link rel="stylesheet" href="\/__flash\/ui\/view-transitions\.css" data-flash-transitions>/);
  assert.match(response.body, /<\/head>/);
  assert.ok(response.body.indexOf('view-transitions.css') < response.body.indexOf('</head>'));
  assert.equal(response.headers['Content-Length'], String(Buffer.byteLength(response.body)));
});

test('transitions: false desliga a injeção', async () => {
  const flash = app({ transitions: false });
  flash.get('/doc', async (ctx) => ctx.render('document', { title: 'Doc', value: 1 }));

  const response = await request(flash, { path: '/doc' });
  assert.ok(!response.body.includes('view-transitions.css'));
});

test('transitions.href permite servir um CSS próprio', async () => {
  const flash = app({ transitions: { href: '/assets/minhas-transicoes.css' } });
  flash.get('/doc', async (ctx) => ctx.render('document', { title: 'Doc', value: 1 }));

  const response = await request(flash, { path: '/doc' });
  assert.match(response.body, /href="\/assets\/minhas-transicoes\.css"/);
  assert.ok(!response.body.includes('/__flash/ui/view-transitions.css'));
});

test('não injeta duas vezes quando o layout já referencia o CSS', async () => {
  const flash = app();
  flash.get('/doc', async (ctx) => ctx.render('document-linked', { title: 'Doc', value: 1 }));

  const response = await request(flash, { path: '/doc' });
  assert.equal(response.body.match(/view-transitions\.css/g).length, 1);
  assert.match(response.body, /data-vt="flip"/);
});

test('ctx.render({ transition }) grava data-vt no html', async () => {
  const flash = app();
  flash.get('/slide', async (ctx) =>
    ctx.render('document', { title: 'Slide', value: 1 }, { transition: 'slide' })
  );

  const response = await request(flash, { path: '/slide' });
  assert.match(response.body, /<html data-vt="slide" lang="pt-BR">/);
});

test('ctx.transition() também define a transição da página', async () => {
  const flash = app();
  flash.get('/curtain', async (ctx) => {
    ctx.transition('curtain');
    return ctx.render('document', { title: 'Cortina', value: 1 });
  });

  const response = await request(flash, { path: '/curtain' });
  assert.match(response.body, /data-vt="curtain"/);
});

test('transição inválida é ignorada em silêncio', async () => {
  const flash = app();
  flash.get('/bad', async (ctx) => ctx.render('document', { title: 'x', value: 1 }, { transition: '"><script>' }));

  const response = await request(flash, { path: '/bad' });
  assert.equal(response.status, 200);
  assert.ok(!response.body.includes('<script>'));
  assert.ok(!response.body.includes('data-vt'));
});

test('fragmentos não recebem o stylesheet nem data-vt', async () => {
  const flash = app();
  flash.get('/frag', async (ctx) =>
    ctx.fragment('simple', { title: 'Frag', value: 2 }, { target: '#r', transition: 'curtain' })
  );

  const response = await request(flash, { path: '/frag', headers: { 'x-flash-request': 'fragment' } });
  assert.equal(response.headers['X-Flash-Update'], 'replace');
  assert.equal(response.headers['X-Flash-Target'], '#r');
  assert.equal(response.headers['X-Flash-Transition'], 'curtain');
  assert.ok(!response.body.includes('view-transitions.css'));
  assert.ok(!response.body.includes('data-vt'));
});

test('respostas não-HTML não são tocadas', async () => {
  const flash = app();
  flash.get('/json', async (ctx) => ctx.json({ html: '</head>' }));

  const response = await request(flash, { path: '/json' });
  assert.equal(response.body, '{"html":"</head>"}');
});

test('o CSS de transições é servido em /__flash/ui', async () => {
  const flash = app();
  const response = await request(flash, { path: '/__flash/ui/view-transitions.css' });

  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /text\/css/);
  assert.match(String(response.body), /@view-transition\s*\{\s*navigation:\s*auto/);
  assert.match(String(response.body), /prefers-reduced-motion/);
  assert.match(String(response.body), /data-vt="slide"/);
});

test('a página de erro mínima também recebe as transições', async () => {
  const flash = createFlash({ dev: true });
  const response = await request(flash, { path: '/nao-existe' });

  assert.equal(response.status, 404);
  assert.match(String(response.body), /view-transitions\.css/);
});
