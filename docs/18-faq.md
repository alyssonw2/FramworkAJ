---
title: Perguntas frequentes
section: Referência
description: Dúvidas comuns sobre uso, limites e integração.
---

# Perguntas frequentes

## Preciso de build para usar o FLASH?

Não. Templates são lidos do disco em runtime (com cache), e o runtime do
navegador é servido como ESM puro. Build é opcional — útil para minificar,
versionar assets e pré-analisar templates.

## Posso usar o FLASH sem Express?

Sim. Existem dois adaptadores:

```js
import { listen } from 'flash/node';

const { url } = await listen(flash, { port: 3000 });
```

E `flash.handle(req)` é independente de framework — dá para integrar com Fastify,
Koa ou seu próprio servidor.

## Como faço uma SPA?

O FLASH não é uma SPA por padrão. Você pode interceptar navegação e atualizar
regiões, mas o modelo recomendado é HTML renderizado no servidor. Para telas
altamente interativas, use JavaScript convencional ao lado.

## Como adiciono um componente global?

```js
flash.helpers({ brl: (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) });
```

```html
<p>{{ brl(order.total) }}</p>
```

Helpers são funções JS — não recebem `ctx`. Para dados de request, passe via
`ctx.locals` ou props.

## Por que `{{ user.name }}` falha em desenvolvimento?

Modo estrito: a variável `user` não foi passada ao `render` ou é `null`. Use
`{{#if user}}` antes de acessar, ou passe `user: null` explicitamente.

Em produção valores ausentes renderizam vazio (`strict: false`).

## Como exibir HTML vindo do banco?

```html
{{ safeHtml(post.bodySanitizado) }}
```

Sanitize antes, com uma biblioteca dedicada. `safeHtml` marca como confiável —
não limpa nada.

## Como atualizar duas regiões com uma resposta?

Hoje o contrato é uma região por resposta. Padrões possíveis:

- incluir as duas regiões dentro de um alvo comum;
- disparar duas requisições;
- usar `f-target` no cabeçalho `X-Flash-Target` para redirecionar a troca.

## Por que minha ação `f-on:click` não roda?

1. O runtime foi carregado? (`/__flash/client/runtime.js`)
2. A ação foi registrada com `client({ actions })`?
3. O nome bate exatamente (`menu.toggle`)?
4. O console mostra `ação "x" não registrada`?

## O modal não abre

O módulo não é importado automaticamente:

```html
<script type="module" src="/__flash/client/modules/modal.js"></script>
```

E o modal precisa de `data-flash-modal` (o `<ui:modal>` já inclui).

## Posso usar TypeScript?

Os tipos não são publicados nesta versão (`0.1`). A API é pequena e estável o
suficiente para declarações próprias. Suporte oficial está no roadmap.

## Como faço upload de arquivos?

Use formulário tradicional (`multipart/form-data`) — o navegador envia
diretamente. `f-submit="ajax"` não suporta arquivos (envia urlencoded).

## Como testar componentes?

`ViewEngine.renderComponent` aceita um escopo pronto:

```js
await engine.renderComponent('button', { scope: { variant: 'danger', slot: 'Excluir', attrs: '' } });
```

## O FLASH sanitiza HTML de terceiros?

Não. Ele **escapa** tudo por padrão e exige `safeHtml()` para HTML confiável.
Sanitização é responsabilidade da aplicação.

## Como migrar uma aplicação Express existente?

1. Instale o FLASH e mantenha suas rotas existentes.
2. Monte o adapter em um prefixo novo: `app.use('/admin', expressAdapter(flash))`.
3. Migre tela por tela: controller → service → template.
4. Mova validações para services à medida que migra.

Nada obriga uma migração total — o FLASH convive com rotas Express normais.

## Onde encontro exemplos?

- `examples/clients-app` — CRUD completo com auth, busca, paginação, modal e
  toast.
- `examples/docs-site` — este site, construído com o próprio framework.
- `test/` — 90 testes cobrindo parser, expressões, escape, rotas, CSRF e HTTP.

## Como reportar um problema?

Inclua: versão do Node, trecho do template, mensagem de erro completa (com
arquivo e linha) e o `requestId` do log do servidor.
