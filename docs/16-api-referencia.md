---
title: API de referência
section: Referência
description: Assinaturas de todas as funções públicas do FLASH.
---

# API de referência

Importações:

```js
import { createFlash, ViewEngine, parseTemplate } from 'flash';
import { expressAdapter } from 'flash/express';
import { nodeAdapter, createServer, listen } from 'flash/node';
import { session, MemoryStore } from 'flash/session';
import { csrf } from 'flash/csrf';
import { securityHeaders } from 'flash/security';
import { rateLimit } from 'flash/rate-limit';
import { MIME_TYPES } from 'flash/static';
```

## `createFlash(options)`

| Opção | Tipo | Padrão | Descrição |
| --- | --- | --- | --- |
| `views` | string | `null` | diretório de templates |
| `components` | string \| string[] | `[]` | diretórios de componentes (em ordem) |
| `publicDir` | string | `null` | diretório de assets públicos |
| `publicPrefix` | string | `/assets` | prefixo dos assets |
| `runtimePrefix` | string | `/__flash` | prefixo do runtime |
| `runtimeDir` | string \| null | `src/client` | `null` desliga a rota do runtime |
| `helpers` | object | `{}` | helpers de template |
| `dev` | boolean | `NODE_ENV !== 'production'` | modo desenvolvimento |
| `strict` | `boolean \| 'full'` | `dev` | rigor das expressões |
| `maxDepth` | number | `32` | profundidade máxima de includes |
| `requestId` | boolean | `true` | gera `X-Request-Id` |
| `baselineHeaders` | boolean | `true` | `nosniff` + `Referrer-Policy` |
| `cache` | boolean | `true` | reutiliza AST |
| `freeze` | boolean | `!dev` | nunca revalida templates |
| `logger` | object | `console` | precisa de `error()` |
| `transitions` | `boolean \| { href }` | `true` | View Transitions: injeta o CSS em toda página HTML |
| `devtools` | `boolean \| { requestLog, overlay, shortcut, position }` | `dev` | painel de debug e endpoints `/__flash/dev/*` |

Retorna uma instância `Flash`.

### Métodos de `Flash`

| Método | Descrição |
| --- | --- |
| `get/post/put/patch/delete/head/options/all(path, ...handlers)` | registra rotas |
| `route(method, path, ...handlers)` | rota com método explícito |
| `use(...middlewares)` | adiciona middleware |
| `helpers(obj)` | registra helpers |
| `render(name, props, options?)` | renderiza direto (testes, e-mails) |
| `handle(request)` | processa requisição normalizada → `FlashResponse` |
| `assets(dir, { prefix, immutable })` | registra diretório público |
| `onError(fn)` | handler de erro (`(error, ctx) => response?`) |
| `analyze()` | varre templates e reporta capacidades |
| `routes()` | lista rotas |
| `getStats()` | contadores internos |

### Requisição normalizada

```js
{
  method: 'POST',
  path: '/clients?page=2',
  headers: { accept: 'text/html' },
  body: { name: 'Ana' },      // já parseado
  query: { page: '2' },       // opcional
  ip: '127.0.0.1',
  protocol: 'https',
  id: 'uuid'                  // opcional
}
```

## `ctx`

| Membro | Tipo |
| --- | --- |
| `params`, `query`, `body`, `request`, `locals` | objeto |
| `session`, `user`, `csrfToken` | definido por middleware |
| `method`, `path`, `url`, `ip`, `protocol`, `requestId` | string |
| `status`, `headers` | mutáveis |
| `input(name, fallback)`, `string()`, `number()`, `boolean()` | leitura |
| `render(name, props, { status, headers, transition })` | `Promise<FlashResponse>` |
| `fragment(name, props, { target, update, status, transition })` | `Promise<FlashResponse>` |
| `html()`, `text()`, `json()`, `empty()` | `FlashResponse` |
| `redirect(location, status = 303)` | `FlashResponse` |
| `notFound()`, `forbidden()`, `unauthorized()`, `invalid(errors)` | `FlashResponse` |
| `requireUser()`, `requireRole(...roles)` | usuário ou lança |
| `header(name, value)`, `defer(fn)` | cabeçalho/efeito tardio |
| `transition(name)` | escolhe o `data-vt` da página |
| `wantsFragment()`, `wantsJson()` | boolean |

## `FlashResponse`

```js
new FlashResponse({ status, headers, body, type })
response.header(name, value)
response.fragment({ target, update })
```

Helpers de topo: `html`, `text`, `json`, `redirect`, `empty`, `toResponse`.

## Erros

```js
new HttpError(status, message, { expose, code, headers })
new ValidationError(errors, message)
badRequest(), unauthorized(), forbidden(), notFound(),
methodNotAllowed(msg, allowed), conflict(), unprocessable(), tooManyRequests(msg, retryAfter)
```

## `ViewEngine`

```js
new ViewEngine({ views, components, strict, maxDepth, helpers, cache, freeze })
engine.render(name, props, { strict })
engine.renderPartial(name, context)
engine.renderComponent(name, context)
engine.load(kind, name)      // { ast, file, capabilities, defaults }
engine.componentInfo(name)   // { consumedProps, ownedAttributes }
engine.registerHelpers(obj)
engine.analyze()
engine.clearCache()
engine.freeze(true)
```

## Templates

```js
parseTemplate(source, { file })        // → AST
collectCapabilities(ast)               // { directives, components, needsRuntime }
collectConsumed(ast)                   // { identifiers, attributes }
isComponentTag('ui:button')            // → true
class TemplateError extends Error       // file, line, column, snippet
VOID_ELEMENTS                          // Set
```

## Expressões

```js
parseExpression('user.name')                       // AST (cacheado)
evaluateExpression('user.name', scope, options)    // valor
evaluateAst(ast, scope, options)
compileExpression(source)                          // (scope, options) => valor
registerGlobalHelpers({ meuHelper })
clearExpressionCache()
isIdentifier('nome')
class ExpressionError extends Error
EXPRESSION_LIMITS  // { maxLength, maxDepth, maxNodes }
```

`options`: `{ strict, helpers, expression }`.

## Escaping

```js
escapeHtml(value)
escapeAttribute(value)
safeHtml(value)        // → SafeHtml
isSafeHtml(value)
toText(value)
safeUrl(value)
trustedFragment(html)
class SafeHtml
SAFE_HTML              // Symbol.for('flash.safe-html')
```

## Helpers globais

`bool`, `default`, `join`, `upper`, `lower`, `truncate`, `htmlEscape`,
`titleize`, `startsWith`, `contains`, `safeHtml`, `safeUrl`, `vtName`.

```html
<article style="view-transition-name: {{ vtName('card', client.id) }}">…</article>
```

```js
flash.helpers({
  brl(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
});
```

## Middlewares

### `session(options)`

`store`, `secret`, `cookieName`, `maxAge`, `secure`, `sameSite`, `path`,
`rolling`, `logger`. Expõe `middleware.store` e `middleware.cookieName`.

`MemoryStore({ defaultTtl })` com `get`, `set`, `destroy`, `touch`, `cleanup`,
`close`.

### `csrf(options)`

`fieldName`, `headerName`, `sessionKey`, `methods`, `message`.

### `securityHeaders(options)`

`csp`, `frameOptions`, `hsts`, `referrerPolicy`, `permissionsPolicy`,
`crossOriginOpenerPolicy`. Exporta `DEFAULT_CSP`.

### `rateLimit(options)`

`windowMs`, `max`, `key(ctx)`, `message`, `skip(ctx)`; `.reset(key?)`;
`.buckets`.

## Adaptadores

### `expressAdapter(flash, options)`

`bodyLimit`, `parseJson`, `logger`. Devolve um `express.Router`.

### `nodeAdapter(flash, options)`

`maxBodySize`, `logger`. `createServer(flash, options)`,
`listen(flash, { port, host })` → `{ server, port, url, close }`.

## Devtools

```js
import { DevTools, DEVTOOLS_PANEL, DEVTOOLS_STATS } from 'flash';
```

`new DevTools(flash, { requestLog, overlay, shortcut, position })` com
`note(response, ctx)`, `handle(request)`, `inject(response)` e `snapshot()`.
Normalmente você não instancia: `createFlash({ dev: true })` faz isso.

| Rota | Método | Descrição |
| --- | --- | --- |
| `/__flash/dev/stats.json` | GET | snapshot do runtime |
| `/__flash/dev/actions/clear-template-cache` | POST | limpa o cache |
| `/__flash/dev/actions/clear-requests` | POST | limpa o log |
| `/__flash/dev/panel.js` | GET | módulo do painel |

## View Transitions

```js
import {
  PAGE_TRANSITIONS,     // ['fade','slide','slide-back','slide-up','scale','curtain','blur','flip','none']
  isTransitionName,
  vtName,
  applyPageTransition,  // (html, name) → html
  injectTransitionAssets // (html, href) → { html, injected }
} from 'flash';
```

`vtName(prefixo, id)` → `flash-<prefixo>-<id>` normalizado (minúsculo, CSS-safe,
≤ 60 caracteres).

## Runtime do navegador

```js
import {
  client, refresh, runAction, registerActions, registerModule,
  defineState, collectRefs, on, onModelChange, swap, emit, state, actions,
  // View Transitions
  transition, swapWithTransition, setPageTransition, setTransitionName,
  getPageTransition, supportsViewTransitions, prefersReducedMotion
} from '/__flash/client/runtime.js';
```

| Função | Descrição |
| --- | --- |
| `transition(fn, { transition })` | executa `fn` dentro de uma view transition |
| `swapWithTransition(target, html, mode, { transition })` | troca região animada |
| `setPageTransition(name)` / `getPageTransition()` | lê/escreve `data-vt` |
| `setTransitionName(el, name)` | escreve `view-transition-name` |
| `supportsViewTransitions()` / `prefersReducedMotion()` | detecção |

Módulos: `/__flash/client/modules/modal.js` (`open`, `close`, `closeAll`),
`/__flash/client/modules/toast.js` (`toast`, `dismiss`).

Módulo dedicado: `/__flash/client/view-transitions.js`.

## Estáticos

## Estáticos

```js
import { createStaticRoutes, serveStaticFile, MIME_TYPES, DEFAULT_RUNTIME_PREFIX } from 'flash/static';
```

## Cabeçalhos de transição

| Cabeçalho | Direção | Valor |
| --- | --- | --- |
| `X-Flash-Transition` | resposta (fragmento) | `fade`, `slide`, `curtain`, … |

## Compatibilidade

A API pública é estável a partir de `1.0`. Antes disso (`0.x`) mudanças
incompatíveis podem ocorrer em releases `minor`, sempre documentadas.
