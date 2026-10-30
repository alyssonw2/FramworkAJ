---
title: Diretivas client-side
section: Interatividade
description: f-on, f-show, f-model, f-bind, f-class, f-confirm, ações e estado local.
---

# Diretivas client-side

Diretivas são reservadas a **interações locais simples**. Regras de negócio,
permissões e validações continuam no servidor.

## Carregando o runtime

```html
<script type="module" src="/__flash/client/runtime.js"></script>
```

O runtime se inicializa sozinho: `f-show` e `f-model` funcionam sem nenhum
script adicional. Para registrar ações e estado:

```html
<script type="module" src="/assets/app.js"></script>
```

```js
// public/app.js
import { client } from '/__flash/client/runtime.js';

client({
  state: {
    menu: { open: false },
    search: '',
    selected: { name: '' }
  },
  actions: {
    'menu.toggle'({ state }) {
      state.menu.open = !state.menu.open;
    }
  }
});
```

> O runtime expõe `window.flash` para depuração no console
> (`flash.state`, `flash.refresh()`, `flash.runAction('menu.toggle')`).

## Referência das diretivas

| Diretiva | Responsabilidade |
| --- | --- |
| `f-on:evento` | executa uma ação registrada |
| `f-show` | mostra/esconde (atributo `hidden`) |
| `f-model` | ligação de duas vias com o estado local |
| `f-bind:atributo` | reflete um valor em atributo/propriedade |
| `f-class` | alterna classes condicionalmente |
| `f-ref` | nomeia um elemento para uso em ações |
| `f-vt` | define `view-transition-name` (morph de elemento) |
| `f-morph` | nomeia o elemento no clique, antes de navegar |
| `f-transition` | transição usada pela troca do formulário |
| `f-confirm` | pede confirmação antes da ação/submit |
| `f-submit` | aprimora o envio do formulário |
| `f-target` | seletor da região a atualizar |

### `f-on:evento`

```html
<button f-on:click="menu.toggle">Menu</button>
<button f-on:click.prevent="form.enviar">Enviar</button>
<form f-on:submit.prevent="buscar">…</form>
```

Modificadores: `.prevent`, `.stop`, `.self`.

- Um listener **por tipo de evento** é registrado no `document` (delegação).
- A ação recebe `{ state, event, el, refs, args, flash }`.
- Ações podem ser `async`; ao terminar, o runtime reaplica as diretivas.

### `f-show`

```html
<nav f-show="menu.open">…</nav>
<section f-show="items.length > 0">…</section>
```

Usa o atributo `hidden` (acessível e sem CSS extra).

### `f-model`

```html
<input f-model="search" placeholder="Pesquisar">
<input type="checkbox" f-model="form.active">
<select f-model="form.status">…</select>
```

- Aceita caminhos com ponto (`form.address.city`).
- Converte `type="number"`/`range` para número.
- Checkbox → booleano; radio → valor; `select multiple` → array.
- Escreve com `textContent`/`propriedade`, nunca com HTML.

### `f-bind:atributo`

```html
<button f-bind:disabled="saving">Salvar</button>
<span f-bind:textContent="selected.name"></span>
<progress f-bind:value="percent" max="100"></progress>
<a f-bind:href="'/clients/' + selected.id">Abrir</a>
```

- Atributos booleanos: presença/ausência conforme a veracidade.
- `value` e `textContent`: propriedades (texto puro).
- Qualquer outro: `setAttribute` (ou remoção quando `false`/`null`).

### `f-class`

```html
<a f-class="is-active: tab === 'dados', is-danger: hasError">Dados</a>
```

Formato `classe: expressão`, separado por vírgulas. Prefira sempre a forma
explícita — o nome à esquerda é a **classe** aplicada, o da direita é a
**condição**. Um trecho sem `:` alterna uma classe com o mesmo nome do caminho
de estado (uso raro).

### `f-confirm`

```html
<form method="POST" action="/clients/1/delete" f-confirm="Excluir este cliente?">
  <button type="submit">Excluir</button>
</form>
```

Funciona em submits e em elementos com `f-on:*`. O texto é inserido por você no
template; ele é serializado no HTML com escape.

### `f-ref`

```html
<input f-ref="busca">
```

```js
'form.focus'({ refs }) {
  refs.busca.focus();
}
```

### `f-vt`

Dá ao elemento um nome de transição, para que ele "voe" entre duas páginas ou
entre duas versões da mesma região:

```html
<!-- nome literal -->
<article class="detail" f-vt="flash-card">…</article>

<!-- nome calculado -->
<div f-vt="'item-' + selected.id">…</div>
```

Um nome só pode existir uma vez por documento. No servidor, o helper `vtName()`
gera o mesmo tipo de nome:

```html
<a href="/clients/{{ client.id }}" style="view-transition-name: {{ vtName('card', client.id) }}">
```

### `f-morph`

Nomeia o elemento **no instante do clique**, pouco antes da navegação. É o que
permite animar apenas o item clicado em uma lista:

```html
<a class="card" href="/clients/{{ client.id }}" f-morph="flash-card">
  <h3>{{ client.name }}</h3>
</a>
```

Na página de destino, o mesmo nome (`f-vt="flash-card"`) faz o card se
transformar no cabeçalho do detalhe.

### `f-transition`

Define a transição usada quando este formulário atualiza uma região:

```html
<form method="GET" action="/clients" f-submit="ajax" f-target="#results" f-transition="fade">
```

Sem esse atributo, vale o cabeçalho `X-Flash-Transition` enviado pelo servidor
(veja [Transições de página](/docs/transicoes-de-pagina)).

## Estado local

- **Explícito**: você declara o objeto `state`.
- **Sem reatividade mágica**: após cada ação o runtime reaplica as diretivas.
- **Transitório**: não é fonte de verdade — o servidor continua sendo a
  autoridade.

```js
client({
  state: { saving: false, tab: 'dados' },
  actions: {
    async 'form.save'({ state, el }) {
      state.saving = true;

      const response = await fetch(el.action, {
        method: 'POST',
        body: new FormData(el),
        headers: { 'X-Flash-Request': 'fragment' }
      });

      state.saving = false;
      return response.ok;
    }
  }
});
```

## API do runtime

```js
import {
  client, refresh, runAction, registerActions, registerModule,
  defineState, collectRefs, on, onModelChange, swap, state
} from '/__flash/client/runtime.js';
```

| Função | Para quê |
| --- | --- |
| `client({ state, actions, modules })` | ponto de entrada |
| `refresh(root?)` | reaplica diretivas/modulos no documento ou nó |
| `runAction(name, { el, event })` | executa uma ação manualmente |
| `registerActions({...})` | adiciona ações |
| `registerModule(name, { init, destroy })` | módulo de componente |
| `on('flash:update', fn)` | escuta eventos do runtime |
| `swap(target, html, mode)` | troca HTML com limpeza |

### Eventos

| Evento | Quando |
| --- | --- |
| `flash:update` | uma região acabou de ser trocada (dentro de uma view transition) |
| `flash:cleanup` | uma região será substituída (limpeza dos módulos) |
| `flash:action-error` | uma ação lançou exceção |
| `flash:request-error` | falha de rede no envio de formulário |
| `flash:modal-open` / `flash:modal-close` | ciclo de vida do modal |

## Módulos de UI opcionais

```html
<script type="module" src="/__flash/client/modules/modal.js"></script>
<script type="module" src="/__flash/client/modules/toast.js"></script>
```

| Módulo | Uso |
| --- | --- |
| `modal.js` | `[data-flash-open="id"]`, `[data-flash-close]`, `Escape`, foco preso |
| `toast.js` | `[data-flash-toast]` automático + `flash.toast('Salvo!', { tone: 'success' })` |

```js
import { open as openModal, close } from '/__flash/client/modules/modal.js';
import { toast } from '/__flash/client/modules/toast.js';

client({
  state: { selected: {} },
  actions: {
    'clients.show'({ el, state }) {
      state.selected = { name: el.dataset.clientName };
      openModal('client-modal');
    },
    'clients.copied'() {
      toast('Copiado para a área de transferência', { tone: 'success' });
    }
  }
});
```

## Limites (por design)

- Sem roteador client-side obrigatório.
- Sem estado global reativo com dependências implícitas.
- Sem acesso a `window`/`document` dentro de expressões.
- Sem `eval`: valores de diretivas são interpretados por uma AST restrita.

## Limpeza e vazamentos

Como não há listeners por elemento, substituir um fragmento não deixa handlers
órfãos. Módulos que criam estado próprio devem implementar `destroy(root)`; o
runtime dispara `flash:cleanup` no nó que será substituído.
