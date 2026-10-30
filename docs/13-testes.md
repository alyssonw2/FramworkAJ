---
title: Testes
section: Qualidade
description: Testar templates, rotas, CSRF e fluxos completos com node:test.
---

# Testes

O framework é testado com `node:test` (sem dependências). Você pode usar o mesmo
estilo ou Jest/Vitest — nada no FLASH depende de um runner específico.

## Rodando

```bash
npm test               # suíte completa (unidade + integração + runtime)
node --test test/*.test.js
node --test --test-name-pattern="CSRF" test/security.test.js
```

## Estrutura sugerida

```text
test/
├── fixtures/
│   ├── views/
│   └── components/
├── expression.test.js
├── escaping.test.js
├── view.test.js
├── app.test.js
├── security.test.js
└── integration.test.js
```

## Testando templates

```js
import { ViewEngine } from 'flash';

const engine = new ViewEngine({ views: './test/fixtures/views', strict: true });

test('renderiza lista com escape', async () => {
  const html = await engine.render('clients/list', {
    clients: { items: [{ name: '<b>Ana</b>' }] }
  });

  assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
});
```

## Testando rotas sem HTTP

`flash.handle()` recebe uma requisição normalizada e devolve um `FlashResponse`:
rápido, sem portas e sem sockets.

```js
const response = await flash.handle({
  method: 'POST',
  path: '/clients',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: { name: 'Ana', email: 'ana@example.com' }
});

assert.equal(response.status, 303);
assert.equal(response.headers.Location, '/clients');
```

## Testando CSRF

```js
const page = await flash.handle({ method: 'GET', path: '/login' });
const cookie = page.headers['Set-Cookie'][0].split(';')[0];
const token = /name="_csrf" value="([^"]+)"/.exec(page.body)[1];

const ok = await flash.handle({
  method: 'POST',
  path: '/login',
  headers: { cookie },
  body: { _csrf: token, email: 'admin@flash.dev', password: 'admin123' }
});
assert.equal(ok.status, 303);

const missing = await flash.handle({ method: 'POST', path: '/login', headers: { cookie }, body: {} });
assert.equal(missing.status, 403);
```

## Testando fluxo completo (Express + fetch)

```js
import express from 'express';
import { expressAdapter } from 'flash/express';

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const login = await fetch(`${base}/login`);
const cookie = login.headers.getSetCookie()[0].split(';')[0];
```

Um mini "navegador" com cookie jar deixa os testes legíveis:

```js
class Browser {
  jar = new Map();

  absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      this.jar.set(...pair.split('='));
    }
  }

  async get(path) {
    const response = await fetch(base + path, { headers: { cookie: this.cookie() }, redirect: 'manual' });
    this.absorb(response);
    return response;
  }
}
```

## Testando XSS

```js
const html = await engine.render('page', { title: '<script>alert(1)</script>' });

assert.ok(!html.includes('<script>alert(1)</script>'));
assert.match(html, /&lt;script&gt;/);
```

Cubra também atributos (`"><img onerror=...>`) e URLs (`javascript:`).

## Testando expressões

```js
assert.throws(() => evaluateExpression('constructor', {}, { strict: true }));
assert.equal(evaluateExpression('user.name', { user: { name: 'Ana' } }), 'Ana');
```

## Testes end-to-end (navegador)

Para fluxos com JavaScript real (modal, foco, `f-model`, atualização parcial),
use Playwright apontando para o exemplo:

```js
test('busca atualiza somente a região', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/clients');
  await page.fill('#q', 'ana');
  await page.click('button[type=submit]');

  await expect(page.locator('#results')).toContainText('Ana');
  // a página não recarregou:
  expect(await page.evaluate(() => window.__navigations ?? 0)).toBe(0);
});
```

Sugestão de cenários: primeira carga sem JS, formulário tradicional, formulário
aprimorado, atualização parcial, histórico, modal com foco, perda de conexão,
duplo clique, sessão expirada, acesso negado.

## Cobertura de segurança

- [ ] XSS em texto e atributos
- [ ] tentativa de injeção em expressão
- [ ] CSRF ausente/inválido
- [ ] IDOR (acesso a recurso de outro usuário)
- [ ] vazamento entre tenants
- [ ] HTML parcial malicioso
- [ ] poluição de protótipo
- [ ] upload indevido
