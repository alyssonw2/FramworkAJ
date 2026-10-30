import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ViewEngine } from '../src/view/engine.js';
import { escapeCss } from '../src/shared/escaping.js';
import { parseTemplate, TemplateError, collectCapabilities, collectConsumed } from '../src/view/template.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function engine(options = {}) {
  return new ViewEngine({
    views: path.join(HERE, 'fixtures', 'views'),
    components: [path.join(HERE, 'fixtures', 'components')],
    strict: true,
    ...options
  });
}

test('renderiza página com layout, blocos, each, if e componente', async () => {
  const html = await engine().render('page', {
    title: 'Clientes',
    env: 'test',
    user: { name: 'Ana' },
    year: 2026,
    clients: [{ name: 'Ana' }, { name: 'Bruno' }]
  });

  assert.match(html, /<title>Clientes<\/title>/);
  assert.match(html, /data-env="test"/);
  assert.match(html, /Olá, Ana\./);
  assert.match(html, /<li data-index="0" class="first">Ana<\/li>/);
  assert.match(html, /<li data-index="1" class="">Bruno<\/li>/);
  assert.match(html, /&copy; 2026 — Clientes/);
  assert.match(html, /<section class="card">/);
  assert.match(html, /<h2 class="card__title">Total<\/h2>/);
  assert.match(html, /<div class="card__body">2<\/div>/);
  assert.ok(!html.includes('Entrar'), 'não deve renderizar o else');
});

test('renderiza o bloco else do each quando a lista está vazia', async () => {
  const html = await engine().render('page', {
    title: 'Vazio',
    env: 'test',
    user: null,
    year: 2026,
    clients: []
  });

  assert.match(html, /<a href="\/login">Entrar<\/a>/);
  assert.match(html, /<li class="empty">Nenhum<\/li>/);
});

test('escapa dados interpolados', async () => {
  const html = await engine().render('page', {
    title: '<script>alert(1)</script>',
    env: '"><img src=x onerror=alert(1)>',
    user: { name: '<b>Ana</b>' },
    year: 2026,
    clients: [{ name: '<svg onload=alert(1)>' }]
  });

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
});

test('props de componente são opcionais e defaults são aplicados', async () => {
  const cap = collectCapabilities(parseTemplate('<ui:card><p>oi</p></ui:card>'));
  assert.deepEqual([...cap.components], ['ui:card']);

  const html = await engine().render('plain', {});
  assert.match(html, /Sem título/);
  assert.match(html, /<div class="card__body"><p>oi<\/p><\/div>/);

  const consumed = collectConsumed(parseTemplate('<ui:card title="x" data-x="1" />'));
  assert.ok(consumed.attributes.has('title'));
  assert.ok(consumed.attributes.has('data-x'));
});

test('atributos desconhecidos passam pelo componente ({{ attrs }})', async () => {
  const html = await engine().render('plain', {});
  assert.match(html, /<section class="card big" data-test="1">/);
  assert.match(html, /Com título/);
});

test('componente sem props declaradas não duplica atributos', async () => {
  const html = await engine().render('page', {
    title: 't', env: 'e', user: null, year: 1, clients: []
  });
  const card = /<section class="card[^>]*>/.exec(html)[0];
  assert.equal(card.match(/title=/g), null, `atributo title duplicado: ${card}`);
});

test('erro de renderização aponta arquivo, linha e coluna', async () => {
  const e = engine();
  await assert.rejects(
    () => e.render('page', { title: 't', env: 'e', user: null, year: 1 }),
    (error) => {
      assert.ok(error instanceof TemplateError);
      assert.equal(error.file, 'page.html');
      assert.ok(error.line >= 1);
      assert.match(error.message, /page\.html:\d+:\d+/);
      return true;
    }
  );
});

test('detecta tags e blocos mal formados', () => {
  assert.throws(() => parseTemplate('<div>'), /Unclosed <div>/);
  assert.throws(() => parseTemplate('<div></span>'), /Mismatched closing tag/);
  assert.throws(() => parseTemplate('{{#if a}}'), /Unclosed \{\{#if\}\}/);
  assert.throws(() => parseTemplate('{{#if a}}{{/each}}'), /Mismatched closing tag/);
  assert.throws(() => parseTemplate('{{#each list}}'), /Invalid each header/);
  assert.throws(() => parseTemplate('{{{ raw }}}'), /Triple braces are not supported/);
  assert.throws(() => parseTemplate('{{ }}'), /Empty interpolation/);
  assert.throws(() => parseTemplate('{{ unknown(}}'), /Invalid expression/);
  assert.throws(() => parseTemplate('{{> }}'), /requires a partial name/);
  assert.throws(() => parseTemplate('<p a="1" a="2"></p>'), /Duplicate attribute/);
});

test('blocos aninhados e else if', () => {
  const ast = parseTemplate(
    '{{#if a}}A{{else if b}}B{{else}}C{{/if}}' +
    '{{#each list as item, i}}{{#if item.ok}}<b>{{ item.name }}</b>{{/if}}{{/each}}'
  );
  assert.equal(ast.children.length, 2);
  const ifNode = ast.children[0];
  assert.equal(ifNode.type, 'If');
  assert.equal(ifNode.alternate.length, 1);
  assert.equal(ifNode.alternate[0].type, 'If');
});

test('comentários não são renderizados e carregam defaults', async () => {
  const html = await engine().render('page', {
    title: 't', env: 'e', user: null, year: 1, clients: []
  });
  assert.ok(!html.includes('defaults:'));
});

test('include inexistente gera erro claro', async () => {
  const e = engine();
  await assert.rejects(
    () => e.render('nao-existe', {}),
    /Template "nao-existe" not found/
  );
  await assert.rejects(
    () => e.render('../../etc/passwd', {}),
    /Invalid template name/
  );
});

test('profundidade máxima evita ciclos de includes', async () => {
  const e = engine({ maxDepth: 4 });
  await assert.rejects(() => e.render('loop-a', {}), /nesting exceeded/);
});

test('cache é invalidado quando o arquivo muda', async () => {
  const e = engine();
  const first = await e.render('page', { title: 't1', env: 'e', user: null, year: 1, clients: [] });
  assert.match(first, /<title>t1<\/title>/);
  const second = await e.render('page', { title: 't2', env: 'e', user: null, year: 1, clients: [] });
  assert.match(second, /<title>t2<\/title>/);
});

test('modo estrito falha ao imprimir valor inexistente', async () => {
  const e = engine();
  await assert.rejects(
    () => e.render('page', { title: 't', env: 'e', user: null, year: 1 }),
    /"clients" is not defined/
  );
});

test('modo não estrito imprime vazio', async () => {
  const e = engine({ strict: false });
  const html = await e.render('page', { title: 't', env: 'e', user: null, year: 1 });
  assert.match(html, /<li class="empty">Nenhum<\/li>/);
});

test('analyze mapeia diretivas e componentes', async () => {
  const report = await engine().analyze();
  const page = report.templates.find((item) => item.name === 'page');
  const form = report.templates.find((item) => item.name === 'form');

  assert.ok(page);
  assert.ok(page.components.includes('ui:card'));
  assert.ok(form.needsRuntime);
  assert.deepEqual(report.directives, ['f-submit', 'f-target']);
  assert.ok(report.componentTags.includes('ui:card'));
});

test('TemplateError expõe arquivo, linha e coluna', () => {
  try {
    parseTemplate('<div>\n  <span>\n</div>', { file: 'views/x.html' });
    assert.fail('deveria falhar');
  } catch (error) {
    assert.ok(error instanceof TemplateError);
    assert.equal(error.file, 'views/x.html');
    assert.ok(error.line >= 1);
    assert.match(error.message, /views\/x\.html:\d+:\d+/);
  }
});

test('<style> aceita interpolação, blocos e escape de CSS', async () => {
  const html = await engine().render('style-blocks', {
    delay: 120,
    items: [{ id: 'a1' }, { id: 'b2' }],
    injected: 'x;} body{display:none'
  });

  assert.match(html, /--delay: 120ms/);
  assert.match(html, /::view-transition-new\(flash-row-a1\) \{\s*animation-delay: 0ms/);
  assert.match(html, /::view-transition-new\(flash-row-b2\) \{\s*animation-delay: 25ms/);
  assert.ok(!html.includes('display:none'), 'caracteres estruturais devem ser removidos');
  assert.match(html, /\.unsafe-x bodydisplaynone/);
});

test('<script> permanece literal', async () => {
  const html = await engine().render('style-blocks', { delay: 0, items: [], injected: '' });
  assert.match(html, /const literal = "\{\{ notInterpolated \}\}";/);
});

test('escapeCss preserva valores e remove estrutura', () => {
  assert.equal(escapeCss('flash-row-12'), 'flash-row-12');
  assert.equal(escapeCss('35ms'), '35ms');
  assert.equal(escapeCss('#1f5eff'), '#1f5eff');
  assert.equal(escapeCss('a;}b{c:d}'), 'abcd');
  assert.equal(escapeCss('  vários   espaços  '), 'vários espaços');
});
