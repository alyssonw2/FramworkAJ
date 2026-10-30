# FLASH

**Fast Lightweight Application Server-rendered HTML**

> Escreva menos. Entregue HTML. Envie só o JavaScript necessário.

FLASH é um framework full-stack **HTML-first** e **server-rendered** para
sistemas administrativos, CRUDs, painéis, CRM, ERP, PDV e SaaS. A aplicação é
descrita principalmente em HTML: o servidor resolve rotas, carrega dados, executa
regras de negócio, renderiza templates e entrega **HTML pronto**. No navegador,
um runtime pequeno e opcional adiciona interações locais.

- **Zero dependências no navegador** — o runtime é ESM puro, sem bundler.
- **Sem `eval`** — expressões são interpretadas a partir de uma AST restrita.
- **Escape por padrão** — texto, atributos e URLs.
- **Progressive enhancement real** — formulários funcionam sem JavaScript.
- **Servidor como autoridade** — permissões, validações e preços nunca no cliente.
- **Transições entre páginas por padrão** — View Transitions (`@view-transition`)
  ativas sem escrever JavaScript.
- **Painel de debug em dev** — requisições, rotas, templates, estado do cliente e
  overlay de erros (estilo Vite), ativado por `dev: true`.

## Começando

```bash
npm install        # Express (única dependência de servidor) + Tailwind CLI (build do exemplo)
npm test           # 139 testes: unidade, integração HTTP, runtime e devtools
npm run example    # app de clientes completo → http://127.0.0.1:3000 (dev + painel de debug)
npm run docs       # site de documentação     → http://127.0.0.1:4000
npm run build:css  # recompila o CSS do exemplo (Tailwind CSS v4)
```

Login do exemplo: `admin@flash.dev` / `admin123`.

```js
import express from 'express';
import { createFlash } from 'flash';
import { expressAdapter } from 'flash/express';

const flash = createFlash({
  views: './src/views',
  components: ['./src/components'],
  publicDir: './public'
});

flash.get('/clients', async (ctx) => {
  const clients = await clientService.list({ search: ctx.query.q });

  return ctx.render('clients/index', { title: 'Clientes', clients });
});

flash.post('/clients', async (ctx) => {
  await clientService.create(ctx.body);

  return ctx.redirect('/clients');
});

const app = express();
app.use(expressAdapter(flash));
app.listen(3000);
```

```html
{{> layouts/app title="Clientes"}}

{{#content "body"}}
  <h1>Clientes</h1>

  <form method="GET" action="/clients" f-submit="ajax" f-target="#results">
    <input name="q" value="{{ search }}" placeholder="Pesquisar">
    <button type="submit">Buscar</button>
  </form>

  <section id="results">
    {{#each clients.items as client}}
      <p>{{ client.name }} — {{ client.email }}</p>
    {{else}}
      <p>Nenhum cliente encontrado.</p>
    {{/each}}
  </section>
{{/content}}
```

## Documentação

O site completo fica em `examples/docs-site` (construído com o próprio FLASH):

```bash
npm run docs   # → http://127.0.0.1:4000
```

| Documento | Conteúdo |
| --- | --- |
| [Introdução](docs/01-introducao.md) | problema, princípios e quando não usar |
| [Instalação](docs/02-instalacao.md) | requisitos, primeira app, ambientes |
| [Guia rápido](docs/03-guia-rapido.md) | CRUD completo passo a passo |
| [Estrutura do projeto](docs/04-estrutura-do-projeto.md) | camadas e organização |
| [Templates](docs/05-templates.md) | interpolação, blocos, layouts, include, atributos |
| [Componentes](docs/06-componentes.md) | props, defaults, slots, `{{ attrs }}` |
| [Diretivas client-side](docs/07-diretivas-client.md) | `f-on`, `f-show`, `f-model`, ações e estado |
| [Formulários e HTML parcial](docs/08-formularios-e-html-parcial.md) | contrato de atualização de regiões |
| [Transições de página](docs/19-transicoes-de-pagina.md) | View Transitions por padrão + 10 exemplos prontos |
| [Modo dev e devtools](docs/20-modo-dev-e-devtools.md) | painel de debug, endpoints e depuração do servidor |
| [Rotas e contexto](docs/09-rotas-e-contexto.md) | router, middleware, `ctx`, respostas |
| [Sessões e CSRF](docs/10-sessoes-e-csrf.md) | cookies assinados, rotação, tokens |
| [Erros e depuração](docs/11-erros-e-depuracao.md) | diagnóstico com arquivo e linha |
| [Segurança](docs/12-seguranca.md) | XSS, injeção, autorização, headers, CSP |
| [Testes](docs/13-testes.md) | unitários, integração e E2E |
| [Desempenho](docs/14-desempenho.md) | cache, assets, orçamento e medição |
| [Acessibilidade e SEO](docs/15-acessibilidade-e-seo.md) | semântica, foco, ARIA, indexação |
| [API de referência](docs/16-api-referencia.md) | todas as assinaturas públicas |
| [Roadmap e decisões](docs/17-roadmap-e-decisoes.md) | escopo, fases e trade-offs |
| [FAQ](docs/18-faq.md) | dúvidas frequentes |

A especificação original do produto está em
[FLASH-framework-especificacao-v0.1.md](FLASH-framework-especificacao-v0.1.md).

## Exemplos

| Caminho | O que demonstra |
| --- | --- |
| `examples/clients-app` | CRUD com autenticação, busca, paginação, formulários tradicionais, atualização parcial, modal e toast — estilizado com **Tailwind CSS v4** |
| `examples/docs-site` | Markdown → HTML no servidor, layout com sidebar, busca no cliente, tema claro/escuro |

## Como o FLASH funciona

```text
Requisição → Router → Middleware (sessão, CSRF, autorização)
          → Controller → Service → Repository
          → Template (AST) → HTML final
```

| Camada | Responsabilidade |
| --- | --- |
| `src/core` | app, router, contexto, respostas, erros, normalização de requisição |
| `src/view` | parser de templates, renderer, engine (cache, layouts, componentes) |
| `src/shared` | linguagem de expressão e escaping (servidor **e** navegador) |
| `src/client` | runtime do navegador e módulos de UI |
| `src/adapters` | Express, `node:http`, sessão, CSRF, headers, rate limit, estáticos |
| `src/ui` | componentes server-side e CSS opcional |

## Sintaxe em resumo

| Recurso | Exemplo |
| --- | --- |
| interpolação escapada | `{{ client.name }}` |
| condição | `{{#if user}}…{{else}}…{{/if}}` |
| repetição | `{{#each items as item, index}}…{{/each}}` |
| layout | `{{> layouts/app title="X"}}` + `{{#content "body"}}…{{/content}}` |
| include | `{{> clients/list clients=clients}}` |
| componente | `<ui:button type="submit">Salvar</ui:button>` |
| diretiva | `f-on:click`, `f-show`, `f-model`, `f-bind:disabled`, `f-class`, `f-confirm` |
| transição | `data-vt="slide"`, `f-morph="flash-card"`, `ctx.render(..., { transition })` |
| formulário aprimorado | `f-submit="ajax" f-target="#results"` |

## Segurança em destaque

- Escape automático por contexto (texto, atributo, URL).
- Parser de expressão restrito, sem `eval`/`new Function`, com bloqueio de
  `__proto__`/`constructor`.
- CSRF por sessão com comparação em tempo constante.
- Cookies `HttpOnly` + `SameSite` (+ `Secure` atrás de HTTPS).
- CSP estrita por padrão (`script-src 'self'`).
- `requestId` em toda resposta para correlação de logs.
- Stack traces nunca expostos em produção.

## Requisitos

- Node.js 20+
- Express 5.x (opcional — há também um adaptador `node:http`)

## Testes

```bash
npm test
```

Cobrem parser de templates, linguagem de expressão, escape (inclusive CSS),
componentes, layouts, router, `ctx`, erros HTTP, CSRF, sessões, rate limit,
headers, injeção de View Transitions e fluxos completos sobre HTTP com o
adaptador Express.

## Licença

MIT.
