---
title: Sessões e CSRF
section: Servidor
description: Sessões em cookie assinado, rotação após login e proteção CSRF.
---

# Sessões e CSRF

## Sessão

Os dados ficam **no servidor**; o cookie carrega apenas um identificador
aleatório assinado com HMAC.

```js
import { session } from 'flash/session';

flash.use(session({
  secret: process.env.SESSION_SECRET,
  cookieName: 'app.sid',
  maxAge: 8 * 60 * 60,      // segundos
  secure: true,             // em HTTPS
  sameSite: 'Lax',
  rolling: true
}));
```

Cookie gerado:

```text
app.sid=<64 hex>.<assinatura base64url>; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure
```

### Usando a sessão

```js
ctx.session.userId = user.id;
ctx.session.role = user.role;

const id = ctx.session.userId;
delete ctx.session.userId;
```

A sessão é um objeto com acesso por propriedade. Nomes reservados
(`id`, `data`, `regenerate`, `destroy`, `touch`) não podem ser usados como
chaves.

### Ciclo de vida

```js
ctx.session.regenerate();   // novo id, dados limpos — use após login
ctx.session.destroy();      // invalida no servidor e limpa o cookie
```

```js
flash.post('/login', async (ctx) => {
  const user = await authenticate(ctx.string('email'), ctx.string('password'));
  if (!user) return ctx.render('auth/login', { error: 'Credenciais inválidas' }, { status: 422 });

  ctx.session.regenerate();     // previne fixação de sessão
  ctx.session.userId = user.id;

  return ctx.redirect('/clients');
});

flash.post('/logout', async (ctx) => {
  ctx.session.destroy();
  return ctx.redirect('/login');
});
```

### Store

O padrão é memória (um processo). Para múltiplas instâncias, implemente três
métodos:

```js
export const redisStore = {
  async get(id) { /* → objeto | null */ },
  async set(id, data, ttlSeconds) { /* ... */ },
  async destroy(id) { /* ... */ }
};

flash.use(session({ store: redisStore, secret }));
```

### Segurança do cookie

- `HttpOnly` sempre.
- `Secure` quando `secure: true` (produção atrás de HTTPS).
- `SameSite=Lax` (padrão) — reduza para `Strict` se o fluxo permitir.
- Segredo forte: se `secret` não for informado, o framework gera um aleatório e
  **avisa**; reiniciar invalida todas as sessões.

## CSRF

```js
import { csrf } from 'flash/csrf';

flash.use(session({ secret }));
flash.use(csrf());     // sempre depois da sessão
```

Comportamento:

| Item | Valor padrão |
| --- | --- |
| Campo no formulário | `_csrf` |
| Cabeçalho | `X-CSRF-Token` |
| Métodos validados | `POST`, `PUT`, `PATCH`, `DELETE` |
| Armazenamento | sessão (`__csrf`) |
| Comparação | `crypto.timingSafeEqual` |

O token é injetado em todo `render`:

```html
<form method="POST" action="/clients">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">
</form>
```

Falha de validação → `403` com mensagem clara.

### Configuração

```js
flash.use(csrf({
  fieldName: 'authenticity_token',
  headerName: 'x-xsrf-token',
  message: 'Sessão expirada. Recarregue a página.'
}));
```

### AJAX

O runtime envia o token no corpo do formulário. Em chamadas próprias:

```js
await fetch('/clients', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
  },
  body: new URLSearchParams({ name: 'Ana' })
});
```

### Por que não confiar só em `SameSite`?

`SameSite=Lax` ajuda, mas não cobre todos os navegadores/fluxos, nem requisições
de subdomínios, nem formulários GET com efeitos colaterais. O token é a garantia
principal.

## Rate limiting

```js
import { rateLimit } from 'flash/rate-limit';

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: 'Muitas tentativas. Aguarde um minuto.'
});

flash.post('/login', loginLimiter, loginHandler);
```

Em produção multi-instância, troque o armazenamento em memória por um
compartilhado (Redis) mantendo a mesma interface.

## Checklist de autenticação

- [ ] Senhas com hash forte (scrypt/argon2) e comparação em tempo constante.
- [ ] `regenerate()` após login e após mudança de privilégio.
- [ ] `destroy()` no logout.
- [ ] Expiração curta para áreas sensíveis.
- [ ] Rate limit em login, recuperação de senha e endpoints caros.
- [ ] Toda autorização verificada no servidor **por recurso** (evita IDOR).
