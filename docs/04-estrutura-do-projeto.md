---
title: Estrutura do projeto
section: Começando
description: Como organizar controllers, services, repositories, views e componentes.
---

# Estrutura do projeto

```text
my-app/
├── src/
│   ├── app.js                # bootstrap: middlewares, rotas, servidor
│   ├── routes/
│   │   ├── clients.routes.js
│   │   └── auth.routes.js
│   ├── services/             # regras de negócio
│   ├── repositories/         # persistência
│   ├── views/
│   │   ├── layouts/
│   │   ├── clients/
│   │   └── errors/
│   ├── components/           # componentes da aplicação (ui:*)
│   ├── client/
│   │   └── app.js            # estado e ações do navegador
│   └── styles/
├── public/                   # servido em /assets
├── test/
├── package.json
└── flash.config.js           # opcional (veja abaixo)
```

## Responsabilidades

| Camada | Faz | Não faz |
| --- | --- | --- |
| `routes/` | traduz HTTP → serviço; escolhe o tipo de resposta | regra de negócio, SQL |
| `services/` | valida, aplica regras, orquestra transações | ler `ctx`, montar HTML |
| `repositories/` | SQL/ORM, mapeamento de linhas | autorização, formatação |
| `views/` | apresenta dados já prontos | consultar banco, decidir permissão |
| `components/` | trechos de UI reutilizáveis | estado global, acesso a dados |
| `client/` | interação local e estado transitório | validar ou autorizar |

## Controller fino

```js
// ✅ coordena e devolve uma resposta
flash.get('/clients/:id/edit', requireAuth, async (ctx) => {
  const client = await getClient(ctx.params.id);      // service
  return ctx.render('clients/form', { client });      // view
});

// ❌ regra de negócio dentro do controller
flash.post('/clients', async (ctx) => {
  if (!ctx.string('email').includes('@')) { /* ... */ }
  await db.query('INSERT INTO clients ...');
});
```

## View model serializável

Templates recebem **dados puros**: strings, números, booleanos, arrays e
objetos simples. Evite passar instâncias de classes (com getters) ou conexões.

```js
// service devolve um objeto pronto para o template
return {
  items: rows.map((row) => ({ id: row.id, name: row.name, email: row.email })),
  total,
  page,
  pages
};
```

## Componentes da aplicação

`components` aceita **uma lista de diretórios**, resolvidos em ordem. Assim você
usa os componentes do framework e os do projeto juntos:

```js
const flash = createFlash({
  components: [
    './node_modules/flash/src/ui',  // ui:button, ui:field, ui:modal, ...
    './src/components'              // meus componentes
  ]
});
```

O primeiro arquivo encontrado ganha — o que permite **sobrescrever** um
componente do framework no seu projeto, se necessário.

## Arquivos de template

- Um arquivo `.html` por view: `views/clients/index.html` → `render('clients/index')`.
- Partials e layouts seguem a mesma resolução (`views/layouts/app.html`).
- Componentes: `<ui:card>` → `components/card.html`.
- Nomes são validados: `../` e caminhos absolutos são rejeitados.

## Configuração centralizada (opcional)

`createFlash` recebe um objeto — você pode centralizar isso em
`src/config.js` ou ler variáveis de ambiente:

```js
// src/config.js
export const config = {
  views: './src/views',
  components: ['./node_modules/flash/src/ui', './src/components'],
  publicDir: './public',
  dev: process.env.NODE_ENV !== 'production',
  requestId: true,
  baselineHeaders: true
};
```

```js
// src/app.js
const flash = createFlash(config);
```

## Ambientes

| Variável | Efeito |
| --- | --- |
| `NODE_ENV=production` | desliga modo dev, congela cache, esconde stack traces |
| `SESSION_SECRET` | segredo HMAC do cookie de sessão |
| `PORT` / `HOST` | endereço do servidor no exemplo |

> **Nunca** versione segredos. O exemplo usa um segredo de desenvolvimento
> explícito e avisa quando nenhum `SESSION_SECRET` é definido.

## Escalando a organização

- Muitas rotas? Um arquivo `routes/*.routes.js` por recurso, todos registrados
  no `app.js`.
- Muitas ações no cliente? Quebre `client/app.js` em módulos e importe-os.
- Muitos componentes? Subpastas são suportadas: `<ui:form/field>` não, mas
  `<form:field>` → `components/field.html` (o namespace é ignorado) — prefira
  nomes distintos como `ui:field-text`.
