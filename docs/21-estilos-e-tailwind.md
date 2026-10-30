---
title: Estilos e Tailwind CSS
section: Templates
description: Como estilizar uma aplicação FLASH com Tailwind CSS v4, design tokens e componentes.
---

# Estilos e Tailwind CSS

O FLASH **não traz um sistema de CSS**. Templates produzem HTML semântico e
classes; a decisão de como estilizar é da aplicação. Essa é uma escolha
deliberada: o framework não deve competir com o design system do seu produto.

Existem três caminhos, e eles combinam entre si:

| Caminho | Quando usar |
| --- | --- |
| **Tailwind CSS** (recomendado) | interfaces sob medida, utilities + tokens |
| **`/__flash/ui/flash.css`** | começar rápido, sem build |
| **CSS próprio** | design system existente, BEM, CSS Modules |

## Opção 1 — Tailwind CSS v4 (exemplo completo)

O exemplo `examples/clients-app` é estilizado inteiramente com Tailwind e serve
de referência executável.

### Instalação

```bash
npm install -D tailwindcss @tailwindcss/cli
```

O Tailwind v4 é compilado para um arquivo estático — o navegador não precisa de
bundler, runtime ou configuração em JavaScript.

### Ponto de entrada

`src/styles/tailwind.css`:

```css
@import "tailwindcss" source(none);

/* Só varremos o que realmente contém classes: */
@source "../views/**/*.html";
@source "../components/**/*.html";
@source "../../public/app.js";
```

`source(none)` desliga a detecção automática. Isso importa porque templates
`.html` não são o único lugar com classes: componentes, partials e até strings no
JavaScript do cliente podem conter utilitários.

### Design tokens

```css
@theme {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --color-canvas: #f5f6f8;
  --color-surface: #ffffff;
  --color-line: #dfe3ea;
  --color-ink-900: #14181f;
  --color-ink-500: #5b6473;

  --color-brand-600: #1f5eff;
  --color-brand-700: #1a4fd6;

  --color-danger-50: #fdecef;
  --color-danger-600: #d2354a;
  --color-success-700: #1f8a52;

  --radius-card: 0.75rem;
  --shadow-card: 0 1px 2px rgb(16 24 40 / 0.06),
                 0 8px 24px -12px rgb(16 24 40 / 0.18);
}
```

Os tokens viram utilitários automaticamente:

```html
<body class="bg-canvas text-ink-900 font-sans">
  <div class="rounded-card border border-line bg-surface shadow-card">
```

| Token | Utilitários gerados |
| --- | --- |
| `--color-ink-900` | `bg-ink-900`, `text-ink-900`, `border-ink-900` |
| `--radius-card` | `rounded-card` |
| `--shadow-card` | `shadow-card` |
| `--font-sans` | `font-sans` |

### Componentes do framework

Os componentes `<ui:*>` emitem classes estáveis (`btn`, `badge`, `field`,
`modal`, `toast`, `pagination`, `empty-state`, `spinner`). Basta descrevê-las uma
vez com `@apply` — os templates continuam limpos e o CSS vira um único arquivo.

```css
@layer components {
  .btn {
    @apply inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg
           border border-transparent px-4 py-2 text-sm font-semibold
           disabled:cursor-progress disabled:opacity-60;
  }

  .btn--primary { @apply bg-brand-600 text-white hover:bg-brand-700; }
  .btn--secondary { @apply border-line bg-surface text-ink-900; }
  .btn--ghost { @apply bg-transparent text-ink-500 hover:text-ink-900; }
  .btn--danger { @apply bg-danger-600 text-white; }
  .btn--sm { @apply px-2.5 py-1.5 text-xs; }
  .btn--block { @apply w-full; }

  .badge { @apply inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-ink-500; }
  .badge--success { @apply bg-success-50 text-success-700; }
  .badge--danger { @apply bg-danger-50 text-danger-600; }

  .field__control {
    @apply w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm
           focus:border-brand-600 focus:outline-2 focus:outline-brand-600/20;
  }

  .modal__backdrop { @apply absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]; }
  .modal__dialog { @apply relative w-[min(92vw,32rem)] rounded-card bg-surface shadow-card; }
  .toast { @apply rounded-lg bg-ink-900 px-3.5 py-2.5 text-sm text-white; }
  .toast--success { @apply bg-success-700; }
}
```

Depois disso, o componente usado no template já sai estilizado:

```html
<ui:button type="submit" variant="primary">Salvar</ui:button>
<!-- → <button class="btn btn--primary" type="submit">Salvar</button> -->
```

Para conferir tudo o que os componentes emitem:

```bash
grep -rhoE 'class="[^"]*"' src/ui/*.html | sort -u
```

### Páginas com utilities

Nas views da aplicação, prefira utilities:

```html
<main class="mx-auto w-full max-w-5xl flex-1 px-6 pb-12 pt-8">
  <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Clientes</h1>
      <p class="m-0 mt-1 text-sm text-ink-500">{{ total }} registro(s)</p>
    </div>
    <a class="btn btn--primary" href="/clients/new">Novo cliente</a>
  </header>

  <section id="results" class="rounded-card border border-line bg-surface shadow-card">
    {{> clients/list}}
  </section>
</main>
```

> Classes condicionais funcionam direto na interpolação — o atributo `class` é
> escapado como qualquer outro valor:
>
> ```html
> <a class="rounded-lg px-2 py-1.5 {{ startsWith(currentPath, '/clients') ? 'bg-white/12 text-white' : 'text-slate-300' }}">
> ```

### Build

```bash
# uma vez
npx @tailwindcss/cli -i src/styles/tailwind.css -o public/app.css --minify

# durante o desenvolvimento
npx @tailwindcss/cli -i src/styles/tailwind.css -o public/app.css --watch
```

No repositório do exemplo os scripts já existem:

```bash
npm run build:css    # compila examples/clients-app/public/app.css
npm run watch:css    # build contínuo
```

E o layout só precisa de um link:

```html
<link rel="stylesheet" href="/assets/app.css">
```

O arquivo é servido pelo FLASH a partir de `publicDir` (`/assets`), com `ETag` e
`Cache-Control` corretos. Em produção, adicione hash no nome para cache longo:

```js
flash.assets('./public', { prefix: '/assets', immutable: true });
```

### Dark mode

Com `prefers-color-scheme`, sem JavaScript:

```css
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-canvas: #f5f6f8;
  --color-ink-900: #14181f;
}

.dark {
  --color-canvas: #0e1116;
  --color-ink-900: #e8ecf3;
}
```

```html
<html class="dark">
```

O servidor pode decidir a classe (cookie, perfil do usuário) antes de renderizar —
o tema chega correto na primeira resposta, sem flash de tema errado:

```js
flash.use(async (ctx) => {
  ctx.locals.theme = ctx.request.cookies.theme === 'dark' ? 'dark' : '';
});
```

```html
<html lang="pt-BR" class="{{ theme }}">
```

## Opção 2 — CSS do framework

Sem build, sem dependências:

```html
<link rel="stylesheet" href="/__flash/ui/flash.css">
```

Traz estilos base para todos os componentes `<ui:*>`, com variáveis
customizáveis:

```css
:root {
  --flash-primary: #1f5eff;
  --flash-danger: #d2354a;
  --flash-radius: 10px;
  --flash-font: system-ui, sans-serif;
}
```

Bom para protótipos e para telas internas. Para um produto com identidade
própria, copie o arquivo como ponto de partida e evolua a partir dele.

## Opção 3 — CSS próprio

Como os componentes emitem classes semânticas (`btn--primary`, `field__control`,
`modal__dialog`), qualquer CSS funciona:

```css
.btn--primary {
  background: var(--marca);
  color: white;
  border-radius: 6px;
}
```

## Sobrescrevendo componentes

`components` aceita vários diretórios e resolve **em ordem**. Para trocar a
aparência (ou a estrutura) de um componente do framework, crie um arquivo com o
mesmo nome antes dele:

```js
createFlash({
  components: [
    './src/components',      // 1º: vence
    './node_modules/flash/src/ui'
  ]
});
```

```html
<!-- src/components/button.html -->
{{! defaults: {"type": "button", "variant": "primary", "class": ""} }}
<button class="btn btn--{{ variant }}{{ class ? ' ' + class : '' }}" type="{{ type }}" {{ attrs }}>{{ slot }}</button>
```

Assim você mantém o mesmo `<ui:button>` em todas as telas e muda o resultado em um
único arquivo.

## CSS gerado no template

`<style>` aceita interpolação e blocos, com escape de contexto CSS:

```html
<style>
  {{#each clients.items as client, index}}
  ::view-transition-new({{ vtName('row', client.id) }}) {
    animation-delay: {{ index * 35 }}ms;
  }
  {{/each}}
</style>
```

Isso serve para **valores dinâmicos** (atrasos, cores por tenant, larguras
calculadas). Para classes, prefira utilitários no HTML: o navegador consegue
cachear o CSS e o HTML continua sendo o contrato da tela.

## CSP

A CSP padrão permite CSS inline (`style-src 'self' 'unsafe-inline'`), necessário
para `style="..."` e `<style>` gerados. Se você remover `unsafe-inline`, troque os
estilos inline por classes:

```js
flash.use(securityHeaders({
  csp: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'"
}));
```

## Checklist

- [ ] Tokens (`@theme`) definidos antes de escrever utilitários
- [ ] `@source` aponta para views, components e JS do cliente
- [ ] Componentes `<ui:*>` mapeados em `@layer components`
- [ ] Um único CSS compilado, com hash e cache longo em produção
- [ ] Tema aplicado no servidor (sem flash de tema)
- [ ] `prefers-reduced-motion` respeitado
- [ ] Contraste e foco visível verificados (veja [Acessibilidade e SEO](/docs/acessibilidade-e-seo))
