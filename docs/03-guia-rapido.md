---
title: Guia rápido
section: Começando
description: Um CRUD completo em FLASH, do repositório ao HTML parcial.
---

# Guia rápido

Vamos construir um CRUD de clientes com busca, paginação, formulários
tradicionais e atualização parcial. O resultado final está em
`examples/clients-app`.

## 1. Camada de dados

```js
// src/repositories/client.repository.js
export class ClientRepository {
  #clients = new Map();

  async list({ search = '', page = 1, perPage = 8 }) {
    const items = [...this.#clients.values()]
      .filter((client) => client.name.toLowerCase().includes(search.toLowerCase()));

    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;

    return { items: items.slice(start, start + perPage), total, page, pages };
  }

  async findById(id) { return this.#clients.get(id) ?? null; }
  async create(data) { /* ... */ }
  async update(id, data) { /* ... */ }
  async remove(id) { return this.#clients.delete(id); }
}
```

## 2. Regras de negócio

```js
// src/services/client.service.js
import { ValidationError, notFound } from 'flash';

export async function createClient(input) {
  const errors = {};

  if (!input.name || input.name.trim().length < 3) {
    errors.name = 'Informe pelo menos 3 caracteres.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.email ?? '')) {
    errors.email = 'Informe um e-mail válido.';
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  return clientRepository.create(input);
}

export async function getClient(id) {
  const client = await clientRepository.findById(id);
  if (!client) throw notFound('Cliente não encontrado.');
  return client;
}
```

> **Regra:** quem valida de verdade é o servidor. O HTML pode usar `required`
> e `type="email"`, mas isso é só conveniência de interface.

## 3. Rotas

```js
// src/routes/clients.routes.js
import { ValidationError } from 'flash';

export function registerClientRoutes(flash, { requireAuth }) {
  flash.get('/clients', requireAuth, async (ctx) => {
    const view = await listViewModel(ctx);

    if (ctx.wantsFragment()) return ctx.fragment('clients/list', view);
    return ctx.render('clients/index', view);
  });

  flash.post('/clients', requireAuth, async (ctx) => {
    try {
      await createClient({ name: ctx.string('name'), email: ctx.string('email') });
    } catch (error) {
      if (error instanceof ValidationError) {
        return ctx.render('clients/form', { errors: error.errors /* ... */ }, { status: 422 });
      }
      throw error;
    }

    return ctx.redirect('/clients'); // 303 See Other
  });
}
```

## 4. Layout e página

```html
<!-- views/layouts/app.html -->
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>{{ title }} · Admin</title>
  <link rel="stylesheet" href="/__flash/ui/flash.css">
  <script type="module" src="/__flash/client/runtime.js"></script>
</head>
<body>
  <header class="topbar">{{ title }}</header>
  {{ body }}
</body>
</html>
```

```html
<!-- views/clients/index.html -->
{{> layouts/app title="Clientes"}}

{{#content "body"}}
  <main>
    <h1>Clientes</h1>

    <form method="GET" action="/clients" f-submit="ajax" f-target="#results">
      <label class="visually-hidden" for="q">Pesquisar</label>
      <input id="q" name="q" value="{{ search }}" placeholder="Pesquisar">
      <button type="submit">Buscar</button>
    </form>

    <section id="results">
      {{> clients/list}}
    </section>
  </main>
{{/content}}
```

## 5. Fragmento reutilizável

```html
<!-- views/clients/list.html -->
{{#if clients.items.length}}
  <table>
    <tbody>
      {{#each clients.items as client}}
        <tr>
          <td>{{ client.name }}</td>
          <td>{{ client.email }}</td>
          <td>
            <form method="POST" action="/clients/{{ client.id }}/delete"
                  f-submit="ajax" f-target="#results"
                  f-confirm="Excluir {{ client.name }}?">
              <input type="hidden" name="_csrf" value="{{ csrfToken }}">
              <button type="submit">Excluir</button>
            </form>
          </td>
        </tr>
      {{else}}
        <tr><td>Nenhum cliente encontrado.</td></tr>
      {{/each}}
    </tbody>
  </table>

  <ui:pagination page="{{ page }}" pages="{{ pages }}" prevUrl="{{ prevUrl }}" nextUrl="{{ nextUrl}}"></ui:pagination>
{{else}}
  <ui:empty-state title="Nenhum cliente" description="Cadastre o primeiro."></ui:empty-state>
{{/if}}
```

O mesmo `clients/list` serve para a página completa e para a atualização
parcial. É o "fragmento como cidadão de primeira classe".

## 6. Bootstrap da aplicação

```js
// src/app.js
import express from 'express';
import { createFlash } from 'flash';
import { expressAdapter } from 'flash/express';
import { session } from 'flash/session';
import { csrf } from 'flash/csrf';
import { securityHeaders } from 'flash/security';

const flash = createFlash({
  views: './src/views',
  components: ['./node_modules/flash/src/ui', './src/components'],
  publicDir: './public'
});

flash.use(securityHeaders());
flash.use(session({ secret: process.env.SESSION_SECRET }));
flash.use(csrf());

flash.use(async (ctx) => {
  if (ctx.session.userId) ctx.user = await findUserById(ctx.session.userId);
  ctx.locals.currentPath = ctx.path;
});

const requireAuth = async (ctx) => ctx.user ? undefined : ctx.redirect('/login');

registerClientRoutes(flash, { requireAuth });

const app = express();
app.use(expressAdapter(flash));
app.listen(3000);
```

## 7. Resultado

- `GET /clients` → HTML completo com busca e paginação.
- Buscar no formulário → `GET /clients` com `X-Flash-Request: fragment` →
  servidor devolve só o fragmento → runtime troca `#results`.
- Sem JavaScript: o formulário faz um GET normal e a página inteira recarrega.
- Excluir → POST com CSRF + confirmação → fragmento atualizado no lugar.

## Próximo passo

- [Templates](/docs/templates) — toda a sintaxe.
- [Formulários e HTML parcial](/docs/formularios-e-html-parcial) — o contrato
  completo de atualização.
