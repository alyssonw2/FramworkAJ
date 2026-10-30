---
title: Segurança
section: Qualidade
description: XSS, injeção de expressão, CSRF, autorização, headers e supply chain.
---

# Segurança

Segurança é requisito do núcleo — não um plugin. Esta página resume as proteções
implementadas e o que continua sendo responsabilidade da aplicação.

## XSS

| Vetor | Proteção |
| --- | --- |
| interpolação em texto | escape de `& < > " ' \`` |
| valor de atributo | mesmo escape contextual |
| URL em `href`/`src`/`action` | esquemas perigosos viram `#` |
| HTML de terceiros | precisa de `safeHtml()` explícito |
| scripts em fragmentos | `innerHTML` não executa `<script>`; nunca usamos `eval` |
| texto no cliente | `textContent` em `f-bind:textContent` |

```html
<!-- o atacante não consegue injetar -->
<p>{{ userComment }}</p>
<a href="{{ maybeMaliciousUrl }}">Abrir</a>
```

```js
import { escapeHtml, safeUrl, safeHtml } from 'flash';

escapeHtml('<img onerror=alert(1)>'); // '&lt;img onerror=alert(1)&gt;'
safeUrl('javascript:alert(1)');       // '#'
safeHtml('<p>confiável</p>');         // marcado como seguro — use com cuidado
```

> Sanitização **não** substitui escape contextual. Se você precisa exibir HTML
> vindo de usuários, sanitize com uma biblioteca dedicada **e** marque com
> `safeHtml()`.

### CSP

O middleware `securityHeaders()` aplica por padrão:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self';
frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

O runtime não usa `eval`, `new Function` nem scripts inline — por isso
`script-src 'self'` funciona sem exceções.

## Injeção de expressão

- Parser próprio com AST; **sem** `eval` e **sem** `new Function`.
- Sem acesso a `window`, `document`, `process`, `globalThis`.
- Chamadas apenas para helpers registrados.
- Bloqueio de `__proto__`, `constructor`, `prototype` (evita poluição de
  protótipo via expressão).
- Limites: expressão ≤ 1024 caracteres, profundidade ≤ 32, ≤ 512 nós.

```js
// todas lançam ExpressionError
'process.env'
'list.constructor.constructor("return process")()'
'__proto__.isAdmin'
```

## CSRF

- Token por sessão, comparado com `timingSafeEqual`.
- Validação em `POST/PUT/PATCH/DELETE`.
- Funciona em formulários tradicionais e em AJAX.
- `SameSite` é defesa adicional, nunca a única.

## Autorização

```js
flash.get('/clients/:id', requireAuth, async (ctx) => {
  const client = await getClient(ctx.params.id);

  // autorização por recurso — evita IDOR
  if (ctx.user.role !== 'admin' && client.ownerId !== ctx.user.id) {
    throw forbidden();
  }

  return ctx.render('clients/show', { client });
});
```

Regras:

1. Autorize **toda** operação no servidor.
2. Nunca confie em botão oculto, `f-show` ou `f-bind:disabled`.
3. Em multi-tenant, filtre **sempre** por organização na consulta.
4. Valide IDs e converta tipos antes de consultar.
5. Audite operações críticas.

## Entrada de dados

- Valide no servidor (tipo, tamanho, formato, domínio).
- Use consultas parametrizadas/ORM — nunca concatene SQL.
- Limite o tamanho do corpo: `expressAdapter(flash, { bodyLimit: '256kb' })`.
- Não aceite campos em massa: selecione explicitamente o que cada operação
  escreve.

```js
const input = { name: ctx.string('name'), email: ctx.string('email') }; // ✅
await clientRepository.create(ctx.body);                               // ❌
```

## Cabeçalhos

```js
import { securityHeaders } from 'flash/security';

flash.use(securityHeaders({
  csp: undefined,                  // usa o padrão
  frameOptions: 'DENY',
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
  referrerPolicy: 'strict-origin-when-cross-origin'
}));
```

Sempre presente (baseline do framework):

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `X-Request-Id`

## Sessão e cookies

- Cookie `HttpOnly` + `SameSite` (+ `Secure` em HTTPS).
- ID aleatório de 32 bytes assinado com HMAC-SHA256.
- Rotação no login (`regenerate`).
- Invalidação no logout (`destroy`).

## HTML parcial

- O runtime só substitui o alvo declarado.
- Scripts recebidos em fragmentos não são executados.
- Não existe`innerHTML` com dados do usuário: o HTML vem do seu servidor.
- Antes de trocar uma região, `flash:cleanup` permite limpar módulos.

## Uploads

- Valide tipo por conteúdo, não por extensão.
- Renomeie arquivos; nunca use o nome original em disco.
- Guarde fora do diretório público ou sirva por uma rota autorizada.
- Limite tamanho e quantidade.

## Dependências

- Dependência de produção: **express** apenas.
- Runtime do navegador: **zero** dependências.
- Use lockfile, versões fixas e `npm audit` no CI.
- Gere SBOM em releases quando o processo permitir.

## Checklist antes de publicar

- [ ] `NODE_ENV=production` (sem stack trace, cache congelado).
- [ ] `SESSION_SECRET` forte e estável.
- [ ] `secure: true` nos cookies + HTTPS + HSTS.
- [ ] CSP sem `unsafe-inline` em `script-src`.
- [ ] CSRF ativo em todas as mutações.
- [ ] Rate limit em login e endpoints caros.
- [ ] Validação e autorização revisadas por recurso.
- [ ] Logs sem dados sensíveis.
