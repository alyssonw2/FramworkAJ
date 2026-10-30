---
title: Instalação
section: Começando
description: Requisitos, instalação, primeira aplicação e execução dos exemplos.
---

# Instalação

## Requisitos

- **Node.js 20+** (o projeto é testado com Node 20, 22 e 24).
- Nenhum bundler, transpilador ou etapa de build é necessária.
- Express **5.x** é a única dependência de servidor.

## Instalando

```bash
# no diretório do framework
npm install

# roda a suíte de testes
npm test
```

Em um projeto novo, adicione o framework como dependência local (ou publique-o
em seu registry privado):

```json
{
  "type": "module",
  "dependencies": {
    "flash": "file:../FramworkAJ",
    "express": "^5.1.0"
  }
}
```

## Estrutura mínima

```text
my-app/
├── src/
│   ├── app.js
│   ├── views/
│   │   ├── layouts/app.html
│   │   └── home.html
│   └── components/          # opcional
├── public/                  # assets servidos em /assets
└── package.json
```

## Olá, FLASH

**`src/views/layouts/app.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>{{ title }}</title>
</head>
<body>
  {{ body }}
  <script type="module" src="/__flash/client/runtime.js"></script>
</body>
</html>
```

**`src/views/home.html`**

```html
{{> layouts/app title="Início"}}

{{#content "body"}}
  <h1>{{ title }}</h1>
  <p>Olá, {{ name }}.</p>
{{/content}}
```

**`src/app.js`**

```js
import express from 'express';
import { createFlash } from 'flash';
import { expressAdapter } from 'flash/express';

const flash = createFlash({
  views: './src/views',
  components: './src/components',
  publicDir: './public',
  publicPrefix: '/assets'
});

flash.get('/', async (ctx) => ctx.render('home', { title: 'Início', name: 'mundo' }));

const app = express();
app.use(expressAdapter(flash));
app.listen(3000, () => console.log('http://localhost:3000'));
```

```bash
node src/app.js
# → http://localhost:3000  entrega HTML completo, sem JavaScript obrigatório
```

## O que o framework serve sozinho

| URL | Conteúdo |
| --- | --- |
| `/__flash/client/*` | runtime do navegador e módulos de UI |
| `/__flash/shared/*` | avaliador de expressões e escaping compartilhados |
| `/__flash/ui/*` | componentes e o CSS opcional `flash.css` |
| `/assets/*` | seu diretório `publicDir` (configurável) |

Nada disso precisa de CDN ou etapa de build.

## Exemplos incluídos

```bash
npm run example     # app de clientes completo em http://127.0.0.1:3000
npm run docs        # este site de documentação em http://127.0.0.1:4000
npm run build:css   # recompila o CSS do exemplo (Tailwind CSS v4)
```

Login do exemplo: `admin@flash.dev` / `admin123`. Em desenvolvimento o painel de
debug vem ativo — veja [Modo dev e devtools](/docs/modo-dev-e-devtools).

## Modo desenvolvimento x produção

| Opção | Dev (padrão) | Produção |
| --- | --- | --- |
| `strict` | `true` — erros de expressão viram exceção | `false` |
| `freeze` (cache) | `false` — revalida por `mtime` | `true` |
| página de erro | mostra stack trace | mostra apenas o `requestId` |
| `Cache-Control` dos assets | `no-cache` | `max-age` + `ETag` |
| devtools (painel) | ativo | inexistente |

Basta definir `NODE_ENV=production` (ou passar `dev: false`). O painel de debug é
detalhado em [Modo dev e devtools](/docs/modo-dev-e-devtools).

## Próximo passo

[Guia rápido](/docs/guia-rapido) — construir um CRUD com busca, paginação,
formulários e atualização parcial.
