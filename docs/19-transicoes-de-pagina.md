---
title: Transições de página
section: Interatividade
description: View Transitions ativas por padrão no FLASH, com 10 transições prontas e animações de elementos.
---

# Transições de página

O FLASH usa a **View Transitions API** por padrão. Toda navegação entre páginas
renderizadas no servidor ganha uma animação curta e discreta, e toda atualização
parcial (`f-submit="ajax"` + `f-target`) é animada exatamente como uma troca de
página.

Nada precisa ser configurado no JavaScript. E, em navegadores sem suporte, tudo
continua funcionando sem animação.

## Como o FLASH faz isso

Existem dois cenários, e o framework cobre os dois:

| Cenário | Quando acontece | Quem executa |
| --- | --- | --- |
| **Cross-document** | navegação normal entre páginas (links, `ctx.redirect`) | CSS: `@view-transition { navigation: auto }` |
| **Same-document** | troca de região por HTML parcial | JS: `document.startViewTransition()` |

Para o primeiro caso, o FLASH injeta automaticamente em **toda resposta HTML
completa**:

```html
<link rel="stylesheet" href="/__flash/ui/view-transitions.css" data-flash-transitions>
```

Esse arquivo contém o opt-in `@view-transition`, as animações padrão e as
variações prontas. Como ele também é servido no documento antigo, o navegador
anima a saída e a entrada.

Para o segundo caso, o runtime do formulário envolve a troca do DOM:

```js
await fetch(url, { headers: { 'X-Flash-Request': 'fragment' } });
// a resposta atualiza o alvo dentro de uma view transition
```

## Verificando que está ativo

```js
// no console do navegador
typeof document.startViewTransition;                 // 'function'
document.documentElement.getAttribute('data-vt');    // ex.: 'fade'
[...document.styleSheets].some((s) => (s.href ?? '').includes('view-transitions.css'));
```

## Configuração

```js
const flash = createFlash({ views: './src/views' });          // ativo (padrão)

createFlash({ views: './src/views', transitions: false });    // desliga tudo

createFlash({
  views: './src/views',
  transitions: { href: '/assets/minhas-transicoes.css' }      // CSS próprio
});
```

| Opção | Efeito |
| --- | --- |
| `transitions: true` (padrão) | injeta o stylesheet do framework |
| `transitions: false` | não injeta nada; você controla o CSS |
| `transitions: { href }` | injeta o seu arquivo, que deve conter o `@view-transition` |

> Se o layout já inclui o `<link>`, o FLASH não injeta de novo. Para desligar
> apenas a injeção e manter o CSS, use `transitions: false` e inclua o link
> manualmente.

## Escolhendo a transição de uma página

A animação é escolhida pelo atributo `data-vt` no elemento `<html>` da página
**de destino**:

```html
<html lang="pt-BR" data-vt="slide">
```

| `data-vt` | Efeito |
| --- | --- |
| `fade` (padrão) | fade cruzado com leve elevação |
| `slide` | conteúdo novo entra pela direita (avançar) |
| `slide-back` | conteúdo novo entra pela esquerda (voltar) |
| `slide-up` | conteúdo sobe (lista → detalhe) |
| `scale` | zoom sutil |
| `curtain` | página nova revelada com `clip-path` |
| `blur` | desfoque cruzado |
| `flip` | giro 3D em Y |
| `none` | sem animação nesta navegação |

Três formas de definir:

```js
// 1. por rota
flash.get('/clients/:id/edit', async (ctx) =>
  ctx.render('clients/form', props, { transition: 'slide' })
);

// 2. explicitamente
flash.get('/relatorios', async (ctx) => {
  ctx.transition('curtain');
  return ctx.render('reports/index', props);
});

// 3. no template (útil para valores dinâmicos)
```

```html
<html lang="pt-BR" data-vt="{{ transition }}">
```

Qualquer outra transição (inclusive nomes novos) pode ser declarada em CSS —
veja os exemplos abaixo.

## Transição da atualização parcial

`ctx.fragment()` informa ao runtime qual animação usar:

```js
return ctx.fragment('clients/list', view, {
  target: '#results',
  transition: 'scale'          // → cabeçalho X-Flash-Transition: scale
});
```

Do lado do formulário, `f-transition` define o padrão quando o servidor não envia
o cabeçalho:

```html
<form method="GET" action="/clients" f-submit="ajax" f-target="#results" f-transition="fade">
```

E no JavaScript:

```js
import { transition, swapWithTransition } from '/__flash/client/runtime.js';

// atualização manual, animada
await fetch('/clients?q=ana')
  .then((r) => r.text())
  .then((html) => swapWithTransition(document.querySelector('#results'), html, 'replace', {
    transition: 'fade'
  }));

// ou envolver qualquer mutação de DOM
transition(() => {
  document.querySelector('#badge').textContent = '3';
});
```

## Elementos compartilhados (morph)

Para um elemento **se transformar** no elemento equivalente da próxima página,
os dois precisam usar o mesmo `view-transition-name`.

**No servidor**, use o helper `vtName()`:

```html
<!-- lista -->
<a class="card" href="/clients/{{ client.id }}"
   style="view-transition-name: {{ vtName('card', client.id) }}">
  <h3>{{ client.name }}</h3>
  <span>{{ client.email }}</span>
</a>
```

```html
<!-- detalhe -->
<article class="detail" style="view-transition-name: {{ vtName('card', client.id) }}">
  <h1>{{ client.name }}</h1>
  <p>{{ client.email }}</p>
</article>
```

`vtName('card', '3F2A-9c')` → `flash-card-3f2a-9c` (minúsculo, CSS-safe, único).

**No navegador**, use `f-vt` (nome literal ou expressão):

```html
<div f-vt="flash-card">…</div>
<div f-vt="'item-' + selected.id">…</div>
```

**Ao clicar**, `f-morph` nomeia o elemento no instante do clique — perfeito para
listas em que só o item clicado deve voar para a próxima página:

```html
<a class="card" href="/clients/{{ client.id }}" f-morph="flash-card">
  <h3>{{ client.name }}</h3>
</a>
```

Regras:

- Um nome só pode existir **uma vez** por documento.
- Nomes precisam existir nas **duas** páginas para o morph.
- O navegador anima posição e tamanho automaticamente; você ajusta aparência
  (cor, raio, sombra) nas pseudo-classes do grupo.

## Acessibilidade

O framework desliga as animações automaticamente quando o usuário pediu menos
movimento:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) { animation: none !important; }
}
```

O runtime também verifica `prefers-reduced-motion` antes de abrir uma transição
same-document, então o conteúdo aparece imediatamente.

---

# Os 10 exemplos

Cada exemplo é independente: copie o CSS para o seu `app.css` e use
`data-vt="nome"` (ou as classes indicadas) no template.

## 1. Fade com elevação (padrão)

**Quando usar:** qualquer navegação sem direção clara — dashboards, abas,
configurações.

```html
<html lang="pt-BR">
<!-- sem data-vt: usa o padrão -->
```

```css
/* já incluído em view-transitions.css */
:root {
  --flash-vt-duration: 260ms;
  --flash-vt-easing: cubic-bezier(0.2, 0.7, 0.2, 1);
  --flash-vt-distance: 10px;
}

@keyframes flash-vt-fade-out {
  to { opacity: 0; }
}

@keyframes flash-vt-rise-in {
  from { opacity: 0; translate: 0 var(--flash-vt-distance); }
}

::view-transition-old(root) {
  animation: flash-vt-fade-out 180ms var(--flash-vt-easing) both;
}

::view-transition-new(root) {
  animation: flash-vt-rise-in var(--flash-vt-duration) var(--flash-vt-easing) both;
}
```

> Ajuste a personalidade do site inteiro mudando apenas `--flash-vt-duration`,
> `--flash-vt-easing` e `--flash-vt-distance`.

## 2. Slide direcional (avançar / voltar)

**Quando usar:** hierarquia clara — lista → detalhe, e o botão "Voltar" inverte
a animação.

```js
// ir para o formulário: entra pela direita
flash.get('/clients/new', requireAuth, async (ctx) =>
  ctx.render('clients/form', view, { transition: 'slide' })
);

// voltar para a lista: entra pela esquerda
flash.get('/clients', requireAuth, async (ctx) =>
  ctx.render('clients/index', view, {
    transition: ctx.query.back === '1' ? 'slide-back' : 'fade'
  })
);
```

```html
<!-- o link carrega a intenção no próprio endereço -->
<a class="btn btn--ghost" href="/clients?back=1">Voltar</a>
```

```css
@keyframes vt-out-left  { to { opacity: .35; translate: -18% 0; } }
@keyframes vt-in-right  { from { opacity: .35; translate: 18% 0; } }
@keyframes vt-out-right { to { opacity: .35; translate: 18% 0; } }
@keyframes vt-in-left   { from { opacity: .35; translate: -18% 0; } }

:root[data-vt="slide"]::view-transition-old(root) { animation-name: vt-out-left; }
:root[data-vt="slide"]::view-transition-new(root) { animation-name: vt-in-right; }

:root[data-vt="slide-back"]::view-transition-old(root) { animation-name: vt-out-right; }
:root[data-vt="slide-back"]::view-transition-new(root) { animation-name: vt-in-left; }
```

Esse é o padrão do `examples/clients-app`: listar → cadastrar usa `slide`,
"Voltar" usa `slide-back`.

## 3. Slide vertical (lista → detalhe)

**Quando usar:** conteúdo que "nasce" de uma lista, como abrir um cliente a
partir de uma tabela.

```js
flash.get('/clients/:id', requireAuth, async (ctx) =>
  ctx.render('clients/show', view, { transition: 'slide-up' })
);
```

```css
@keyframes vt-out-down { to { opacity: .4; translate: 0 6%; } }
@keyframes vt-in-up    { from { opacity: .4; translate: 0 8%; } }

:root[data-vt="slide-up"]::view-transition-old(root) { animation-name: vt-out-down; }
:root[data-vt="slide-up"]::view-transition-new(root) { animation-name: vt-in-up; }
```

## 4. Zoom suave

**Quando usar:** trocar de contexto (workspace → projeto, resumo → detalhes)
sem sugerir direção.

```html
<html lang="pt-BR" data-vt="scale">
```

```css
@keyframes vt-scale-out { to { opacity: 0; scale: 0.97; } }
@keyframes vt-scale-in  { from { opacity: 0; scale: 1.02; } }

:root[data-vt="scale"]::view-transition-old(root) { animation-name: vt-scale-out; }
:root[data-vt="scale"]::view-transition-new(root) { animation-name: vt-scale-in; }
```

## 5. Cortina (wipe com clip-path)

**Quando usar:** onboarding, páginas públicas, transições de "capítulo".

```html
<html lang="pt-BR" data-vt="curtain">
```

```css
@keyframes vt-curtain-out { to { opacity: .6; } }

@keyframes vt-curtain-in {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(0 0 0 0); }
}

:root[data-vt="curtain"]::view-transition-old(root) {
  animation: vt-curtain-out 120ms ease both;
}

:root[data-vt="curtain"]::view-transition-new(root) {
  animation: vt-curtain-in 420ms cubic-bezier(.6, 0, .2, 1) both;
}
```

Variante circular (revela a partir do centro):

```css
@keyframes vt-curtain-circle {
  from { clip-path: circle(0% at 50% 50%); }
  to   { clip-path: circle(140% at 50% 50%); }
}

:root[data-vt="curtain-circle"]::view-transition-new(root) {
  animation: vt-curtain-circle 520ms cubic-bezier(.6, 0, .2, 1) both;
}
```

## 6. Flip 3D

**Quando usar:** alternar entre duas visões do mesmo registro (ficha ↔
histórico), com sensação de "virar a página".

```css
/* o contêiner já tem perspective: 1400px no CSS do framework */
@keyframes vt-flip-out { to { opacity: 0; rotate: y 90deg; } }
@keyframes vt-flip-in  { from { opacity: 0; rotate: y -90deg; } }

:root[data-vt="flip"]::view-transition-old(root) {
  animation-name: vt-flip-out;
  transform-origin: center right;
}

:root[data-vt="flip"]::view-transition-new(root) {
  animation-name: vt-flip-in;
  transform-origin: center left;
}
```

## 7. Desfoque (troca de foco)

**Quando usar:** entrar em um fluxo modal ou em uma área restrita.

```css
@keyframes vt-blur-out { to { opacity: 0; filter: blur(10px); } }
@keyframes vt-blur-in  { from { opacity: 0; filter: blur(10px); } }

:root[data-vt="blur"]::view-transition-old(root) { animation-name: vt-blur-out; }
:root[data-vt="blur"]::view-transition-new(root) { animation-name: vt-blur-in; }
```

> `filter: blur()` é caro. Prefira durações curtas (≤ 300ms) e evite em listas
> grandes. Em aparelhos fracos, `prefers-reduced-motion` já desliga.

## 8. Morph de card compartilhado

**Quando usar:** o item clicado **vira** o cabeçalho da página de detalhe. É a
transição mais impressionante — e a que mais depende de nomes estáveis.

```html
<!-- views/clients/list.html -->
<ul class="card-grid">
  {{#each clients.items as client}}
    <li>
      <a class="card" href="/clients/{{ client.id }}" f-morph="flash-card">
        <strong class="card__name">{{ client.name }}</strong>
        <span class="card__email">{{ client.email }}</span>
      </a>
    </li>
  {{/each}}
</ul>
```

```html
<!-- views/clients/show.html -->
<article class="detail" f-vt="flash-card">
  <h1>{{ client.name }}</h1>
  <p>{{ client.email }}</p>
</article>
```

```css
/* o grupo anima posição e tamanho; aqui ajustamos a aparência */
::view-transition-group(flash-card) {
  animation-duration: 360ms;
  animation-timing-function: cubic-bezier(.2, .8, .2, 1);
}

::view-transition-old(flash-card) {
  animation: flash-card-out 140ms ease both;
}

::view-transition-new(flash-card) {
  animation: flash-card-in 320ms cubic-bezier(.2, .8, .2, 1) both;
}

@keyframes flash-card-out {
  to { opacity: 0; }
}

@keyframes flash-card-in {
  from { opacity: 0; }
}

/* o card de origem: cantos arredondados e sombra */
.card {
  view-transition-class: flash-surface;
  border-radius: 14px;
  box-shadow: var(--flash-shadow);
  background: var(--flash-surface);
}

.detail {
  view-transition-class: flash-surface;
  border-radius: 0;
  background: transparent;
}
```

`view-transition-class` agrupa elementos de mesma natureza e permite escrever
regras sem repetir nomes — útil quando cada card tem um nome único
(`vtName('card', id)`).

## 9. Cabeçalho persistente

**Quando usar:** apps com topbar, sidebar ou tabs fixas. O cromo fica parado
enquanto o conteúdo troca.

```html
<header class="topbar" data-vt-persist>
  <a href="/clients">FLASH admin</a>
  <nav>…</nav>
</header>
```

```css
/* já incluído: nomeia o elemento e remove a animação */
[data-vt-persist] {
  view-transition-name: flash-persist;
}

::view-transition-group(flash-persist),
::view-transition-old(flash-persist),
::view-transition-new(flash-persist) {
  animation: none;
  mix-blend-mode: normal;
}
```

Se você precisa de **dois** elementos persistentes, dê nomes próprios:

```html
<header style="view-transition-name: app-header">…</header>
<aside style="view-transition-name: app-sidebar">…</aside>
```

```css
::view-transition-group(app-header),
::view-transition-group(app-sidebar) {
  animation: none;
  mix-blend-mode: normal;
}
```

## 10. Lista escalonada (stagger)

**Quando usar:** a página de destino tem uma lista e você quer que as linhas
entrem em sequência, como uma tabela sendo preenchida.

```html
<!-- um <style> gerado no servidor: {{#each}} funciona dentro dele -->
<style>
  {{#each clients.items as client, index}}
  ::view-transition-old({{ vtName('row', client.id) }}) {
    animation: row-out 120ms var(--flash-vt-easing) both;
  }
  ::view-transition-new({{ vtName('row', client.id) }}) {
    animation: row-in 280ms var(--flash-vt-easing) both {{ index * 35 }}ms;
  }
  {{/each}}
</style>

<tbody>
  {{#each clients.items as client}}
    <tr style="view-transition-name: {{ vtName('row', client.id) }}">
      <td>{{ client.name }}</td>
      <td>{{ client.email }}</td>
    </tr>
  {{/each}}
</tbody>
```

```css
@keyframes row-out {
  to { opacity: 0; translate: -8px 0; }
}

@keyframes row-in {
  from { opacity: 0; translate: 16px 0; }
}
```

Detalhes importantes:

- `{{ index * 35 }}` gera o atraso em milissegundos — nenhum JavaScript.
- Interpolações dentro de `<style>` são escapadas para **contexto CSS**: apenas
  caracteres seguros sobrevivem, então um valor malicioso não fecha regras.
- Cada linha precisa de um nome único (`vtName('row', client.id)`).
- `<script>` continua literal: nada é interpolado dentro de JavaScript.

---

# Receitas extras

## Modal e toast

Elementos com `view-transition-name` também animam em transições
same-document — inclusive as abertas pelo runtime:

```js
import { transition } from '/__flash/client/runtime.js';

transition(() => {
  document.querySelector('#modal').hidden = false;
});
```

O `<ui:modal>` e o `<ui:toast>` já têm transições próprias de CSS; use
`startViewTransition` apenas quando a troca de conteúdo for estrutural.

## Formulário com erro

O erro volta como fragmento para a mesma região: o runtime anima a troca e o
foco permanece no formulário.

```js
return ctx.fragment('clients/form', { form, errors }, { status: 422, transition: 'fade' });
```

## Abas e filtros

```html
<nav class="tabs">
  <a href="/relatorios?tab=mes" data-vt="fade">Mês</a>
  <a href="/relatorios?tab=ano" data-vt="fade">Ano</a>
</nav>
```

Para trocar sem animação em um caso específico:

```js
return ctx.render('relatorios/index', props, { transition: 'none' });
```

## Voltar/avançar do navegador

Navegações de histórico também são cross-document e animam com o `data-vt` da
página de destino. Se quiser respeitar a direção:

```js
// no cliente, antes de navegar para trás
import { setPageTransition } from '/__flash/client/runtime.js';
window.addEventListener('popstate', () => setPageTransition('slide-back'));
```

## Desligando em um formulário específico

```html
<form method="POST" action="/relatorios" f-submit="ajax" f-target="#lista" f-transition="none">
```

---

# Limites e depuração

## O que não é animado

- Navegações para **outra origem** (o navegador exige mesma origem).
- Requisições que **redirecionam** (POST → 303): o navegador cancela a transição
  do redirecionamento e a página final aparece direto. É comportamento do
  navegador; o fluxo funciona normalmente.
- `prefers-reduced-motion: reduce`.

## Console: "Transition was skipped"

Mensagem do próprio navegador quando uma transição é cancelada — por exemplo em
um POST que responde `303`. Não é erro do seu código e não afeta a navegação.

## Animação não aparece

1. A resposta é HTML **completo** com `<html>` e `</head>`? Fragmentos não
   recebem o stylesheet.
2. `transitions` está ligado? (`flash.config.transitions`)
3. O `<link>` está no HTML? (`curl -s http://localhost:3000/ | grep view-transitions`)
4. `data-vt` chegou no documento novo? (`document.documentElement.dataset.vt`)
5. Reduziu movimento no sistema operacional?

## Dois elementos com o mesmo nome

```
View transition aborted: duplicate view-transition-name
```

Use `vtName(prefixo, id)` para garantir unicidade, ou `f-morph` para nomear
apenas o item clicado.

## Scroll

Transições cross-document combinam com a restauração de scroll do navegador. Em
páginas longas, prefira `fade` (padrão) ou `slide-up`; `curtain` e `flip`
chamam mais atenção e podem incomodar quem rola muito.

## Checklist

- [ ] `data-vt` coerente com a direção da navegação
- [ ] nomes únicos por página (`vtName`/`f-morph`)
- [ ] elementos persistentes com `data-vt-persist`
- [ ] durações entre 150ms e 400ms
- [ ] nada de `filter: blur()` em listas grandes
- [ ] conteúdo funciona com `prefers-reduced-motion: reduce`
- [ ] conteúdo funciona sem suporte a View Transitions
