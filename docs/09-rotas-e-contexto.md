---
title: Rotas e contexto
section: Servidor
description: Router, middleware, ctx e os três tipos de resposta.
---

# Rotas e contexto

## Rotas

```js
flash.get('/clients', requireAuth, handler);
flash.post('/clients', requireAuth, handler);
flash.put('/clients/:id', handler);
flash.patch('/clients/:id', handler);
flash.delete('/clients/:id', handler);
flash.all('/health', handler);          // qualquer método
```

- Parâmetros nomeados: `/clients/:id/edit`.
- Curinga final: `/files/*` → `ctx.params['*']`.
- Barra final é normalizada (`/clients/` = `/clients`).
- Método não permitido → `405` com cabeçalho `Allow`.
- Rota inexistente → `404`, renderizando `errors/404` se existir.

Vários handlers podem ser encadeados; o primeiro que devolver uma resposta
encerra a cadeia:

```js
flash.get('/admin', requireAuth, requireRole('admin'), async (ctx) =>
  ctx.render('admin/home', { title: 'Admin' })
);
```

## Middleware

```js
flash.use(async (ctx) => {
  ctx.locals.currentPath = ctx.path;

  if (ctx.session.userId) {
    ctx.user = await findUserById(ctx.session.userId);
  }

  // retornar uma resposta interrompe o pipeline
  if (ctx.path.startsWith('/admin') && !ctx.user) {
    return ctx.redirect('/login');
  }

  return undefined;
});
```

- A ordem é a ordem de registro.
- `ctx.defer(fn)` agenda trabalho para **depois** do handler (útil para headers,
  `Set-Cookie`, métricas).
- Erros lançados por middleware caem no mesmo tratamento de erros.

## `ctx`

### Dados da requisição

| Propriedade | Conteúdo |
| --- | --- |
| `ctx.params` | parâmetros da rota |
| `ctx.query` | query string (`?a=1` → `{ a: '1' }`; repetidos viram array) |
| `ctx.body` | corpo parseado (formulário ou JSON) |
| `ctx.session` | sessão (precisa do middleware) |
| `ctx.user` | definido por você no middleware |
| `ctx.request` | requisição normalizada (headers, cookies, ip, id) |
| `ctx.method` / `ctx.path` / `ctx.url` | método e caminho |
| `ctx.locals` | valores compartilhados com todos os `render` |
| `ctx.csrfToken` | token atual (middleware de CSRF) |
| `ctx.requestId` | identificador da requisição |
| `ctx.headers` / `ctx.status` | cabeçalhos e status padrão da resposta |

### Helpers de entrada

```js
ctx.input('name', 'padrão');  // body → query → padrão
ctx.string('name');           // trim, '' quando ausente
ctx.number('page', 1);        // Number() com fallback
ctx.boolean('active');        // 1|true|on|yes
```

### Respostas

```js
return ctx.render('clients/index', { title: 'Clientes', clients });
return ctx.render('clients/form', view, { status: 422 });
return ctx.fragment('clients/list', view, { target: '#results' });
return ctx.html('<p>ok</p>');
return ctx.text('ok');
return ctx.json({ ok: true });
return ctx.redirect('/clients');              // 303
return ctx.redirect('/clients', 302);
return ctx.empty();                            // 204
```

Atalhos de erro:

```js
return ctx.notFound('Cliente não encontrado');
return ctx.forbidden();
return ctx.unauthorized();
throw ctx.invalid({ email: 'inválido' });       // ValidationError → 422
```

Autorização:

```js
const user = ctx.requireUser();                 // lança 401
ctx.requireRole('admin');                       // lança 403
```

### Verificações de conteúdo

```js
ctx.wantsFragment();  // X-Flash-Request: fragment
ctx.wantsJson();      // Accept: application/json sem html
ctx.acceptsHtml;
```

## Resposta fragmentada

```js
flash.get('/clients', async (ctx) => {
  const view = await listViewModel(ctx);
  if (ctx.wantsFragment()) return ctx.fragment('clients/list', view);
  return ctx.render('clients/index', view);
});
```

`ctx.fragment` = `render` + cabeçalhos `X-Flash-Update` / `X-Flash-Target`.

## Respostas do framework

Toda resposta é um `FlashResponse`:

```js
import { html, json, redirect, text, empty } from 'flash';

const response = html('<p>ok</p>', { status: 201, headers: { 'X-Anything': '1' } });
response.header('Cache-Control', 'private, max-age=30');
response.fragment({ target: '#results', update: 'append' });
```

## Erros

```js
import { HttpError, ValidationError, notFound, conflict } from 'flash';

throw notFound('Cliente não encontrado.');
throw new HttpError(429, 'Devagar…', { headers: { 'Retry-After': '30' } });
throw new ValidationError({ email: 'E-mail inválido' });
```

`HttpError` expõe a mensagem ao usuário quando `status < 500`; erros `5xx` viram
uma mensagem genérica e um `requestId` para correlação.

## Tratamento de erros personalizado

```js
flash.onError(async (error, ctx) => {
  await auditLog.write({ requestId: ctx.requestId, error: error.message });
  return undefined; // deixa o framework responder
});
```

Se o handler devolver uma resposta, ela é usada. Caso contrário o framework
renderiza `errors/<status>` ou `errors/error`.

## JSON para integrações

Nem toda resposta precisa ser HTML. Endpoints explícitos continuam simples:

```js
flash.get('/api/clients', async (ctx) => {
  const data = await listClients({ search: ctx.string('q') });
  return ctx.json({ data: data.items, meta: { total: data.total } });
});
```
