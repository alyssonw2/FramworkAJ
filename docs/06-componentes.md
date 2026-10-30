---
title: Componentes
section: Templates
description: Componentes server-side, props, defaults, slots e repasse de atributos.
---

# Componentes

Componentes são **templates reutilizáveis renderizados no servidor**. Não têm
estado próprio, não acessam banco e não recebem o escopo da página: recebem
apenas o que o chamador passa.

## Criando

`src/components/button.html`:

```html
{{! defaults: {"type": "button", "variant": "primary", "class": ""} }}
<button class="btn btn--{{ variant }}{{ class ? ' ' + class : '' }}"
        type="{{ type }}"
        {{ attrs }}>{{ slot }}</button>
```

Usando:

```html
<ui:button type="submit" variant="primary">Salvar</ui:button>
```

Regras de resolução:

- A tag precisa ter **um** namespace: `<ui:button>`, `<app:card>`.
- O namespace é ignorado no caminho: `ui:button` → `components/button.html`.
- `components` pode ser uma **lista** de diretórios; o primeiro match ganha.

## Props

Todo atributo vira uma prop:

| Uso | Valor recebido |
| --- | --- |
| `title="Clientes"` | string `"Clientes"` |
| `count="{{ total }}"` | valor **tipado** (número, array, objeto) |
| `required` (sem valor) | `true` |
| `class="extra"` | string (ver [atributos](#repassando-atributos)) |

Propriedades compostas preservam o texto:

```html
<ui:badge tone="success">Ativo</ui:badge>
```

```html
<!-- badge.html -->
{{! defaults: {"tone": "neutral", "class": ""} }}
<span class="badge badge--{{ tone }}{{ class ? ' ' + class : '' }}" {{ attrs }}>{{ slot }}</span>
```

## Defaults

O primeiro comentário do arquivo pode declarar valores padrão (JSON):

```html
{{! defaults: {"title": "Janela", "size": "md", "closeLabel": "Fechar"} }}
```

Defaults deixam o componente legível e evitam `{{#if}}` em cada prop. Props
ausentes **sem** default renderizam vazio (componentes são tolerantes).

## Slot

O conteúdo interno do componente vira o fragmento `slot`, já renderizado e
seguro:

```html
<ui:modal id="confirm" title="Excluir">
  <p>Tem certeza?</p>
</ui:modal>
```

```html
<!-- modal.html -->
<div class="modal" id="{{ id }}" data-flash-modal hidden>
  <div class="modal__backdrop" data-flash-backdrop></div>
  <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="{{ id }}-title">
    <header class="modal__header">
      <h2 id="{{ id }}-title">{{ title }}</h2>
      <button type="button" data-flash-close aria-label="{{ closeLabel }}">&times;</button>
    </header>
    <div class="modal__body">{{ slot }}</div>
  </div>
</div>
```

Um slot por componente (o conteúdo interno). Para "áreas" extras, use props com
fragmentos prontos ou componentes separados.

## Repassando atributos

`{{ attrs }}` dentro de uma tag renderiza os atributos do chamador que o
componente **não consome**:

```html
<ui:button type="submit" data-test="save" aria-label="Salvar">Salvar</ui:button>
<!-- → <button class="btn btn--primary" type="submit" data-test="save" aria-label="Salvar"> -->
```

O motor considera:

- **props usadas em expressões** do template (ex.: `variant`, `type`, `class`);
- **atributos que o template já escreve** (ex.: `class`, `id`, `type`).

Assim nunca há atributo duplicado. Para adicionar classes, use a prop `class`
(convenção adotada por todos os componentes do framework).

## Componentes com comportamento

Um componente pode incluir diretivas `f-*` ou `data-flash-*` e depender de um
módulo do runtime:

```html
<!-- toast.html -->
{{! defaults: {"tone": "info", "duration": 4000, "class": ""} }}
<div class="toast toast--{{ tone }}{{ class ? ' ' + class : '' }}"
     data-flash-toast="{{ duration }}" role="status">{{ slot }}</div>
```

A página precisa carregar `modules/toast.js` — veja
[Diretivas client-side](/docs/diretivas-client).

## Componentes incluídos

| Tag | Props principais |
| --- | --- |
| `<ui:button>` | `type`, `variant`, `class` |
| `<ui:badge>` | `tone` (`neutral`, `success`, `danger`, `warning`, `info`) |
| `<ui:field>` | `name`, `label`, `type`, `value`, `required`, `error`, `hint`, `autocomplete` |
| `<ui:empty-state>` | `title`, `description`, `class` |
| `<ui:pagination>` | `page`, `pages`, `prevUrl`, `nextUrl`, `label` |
| `<ui:modal>` | `id`, `title`, `size` (`sm`/`md`/`lg`), `closeLabel` |
| `<ui:toast>` | `tone`, `duration` |
| `<ui:spinner>` | `label` |

O CSS opcional está em `/__flash/ui/flash.css` — copie e adapte as variáveis
`--flash-*` para a sua identidade visual.

## O que evitar

```html
<!-- ❌ componente que consulta dados -->
<ui:table resource="/clients" auto-load>

<!-- ✅ o controller carrega, o template apresenta -->
{{#each clients.items as client}}
  <tr><td>{{ client.name }}</td></tr>
{{/each}}
```

Componentes não substituem autorização, validação ou regras de negócio. Um
"CRUD mágico" que lê do banco a partir de um atributo HTML é justamente o que o
FLASH não faz.

## Testando componentes

```js
import { ViewEngine } from 'flash';

const views = new ViewEngine({ components: ['./src/components'] });

test('ui:button aplica variante e repassa atributos', async () => {
  const html = await views.renderComponent('button', {
    scope: { variant: 'danger', type: 'submit', attrs: '', slot: 'Excluir' }
  });

  assert.match(html, /btn--danger/);
  assert.match(html, /type="submit"/);
});
```
