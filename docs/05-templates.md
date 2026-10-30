---
title: Templates
section: Templates
description: Interpolação, blocos, layouts, includes, atributos e regras de escape.
---

# Templates

Templates são arquivos `.html` com uma sintaxe mínima de chaves duplas. Tudo é
resolvido **no servidor**: o navegador recebe apenas o HTML resultante.

## Interpolação

```html
<h1>Olá, {{ user.name }}</h1>
<p>Você possui {{ orders.length }} pedidos.</p>
<p>{{ count + 1 }} itens</p>
```

- Todo valor é **escapado** antes de entrar no HTML.
- `null` e `undefined` viram string vazia.
- Objetos e arrays viram JSON (`[1,2]`, `{"a":1}`) — e o JSON também é escapado.
- Funções e símbolos geram erro: não pertencem a uma view.

Para inserir HTML confiável existe uma **API explícita**:

```html
{{ safeHtml(article.bodyExterno) }}
```

> `safeHtml()` não sanitiza nada — ele apenas marca o texto como confiável. Use
> somente com conteúdo que você produziu ou sanitizou com uma biblioteca
> dedicada.

## Expressões suportadas

A linguagem é intencionalmente pequena e interpretada a partir de uma AST
(sem `eval`, sem `new Function`):

| Recurso | Exemplo |
| --- | --- |
| literais | `'texto'`, `42`, `1.5`, `true`, `false`, `null` |
| acesso a propriedade | `user.name`, `client.address.city` |
| índice | `items[0]`, `map[key]` |
| comparação | `===`, `!==`, `==`, `!=`, `<`, `>`, `<=`, `>=` |
| lógica | `&&`, `\|\|`, `!` |
| aritmética | `+`, `-`, `*`, `/`, `%` |
| ternário | `active ? 'Ativo' : 'Inativo'` |
| helpers | `bool(x)`, `join(list)`, `default(x, '—')`, `vtName('card', id)` |

**Não** é possível: acessar `window`, `document`, `process`, `globalThis`,
chamar métodos de dados (`list.map()`, `text.toUpperCase()`) ou invocar funções
que não estejam registradas como helpers.

```html
<!-- métodos não existem: use helpers -->
{{ upper(client.name) }}         <!-- em vez de client.name.toUpperCase() -->
{{ startsWith(path, '/clients') ? 'is-active' : '' }}
```

## Condição

```html
{{#if user}}
  <p>Bem-vindo, {{ user.name }}.</p>
{{else if guest}}
  <p>Olá, visitante.</p>
{{else}}
  <a href="/login">Entrar</a>
{{/if}}
```

Também existe a forma negativa:

```html
{{#unless items.length}}<p>Nenhum item.</p>{{/unless}}
```

> Em condições (`#if`, `#each`) a expressão é **tolerante**: testar uma variável
> que não existe simplesmente resulta em falso. Já a interpolação é estrita em
> desenvolvimento (veja [Modo estrito](#modo-estrito)).

## Repetição

```html
<ul>
  {{#each clients as client, index}}
    <li data-index="{{ index }}">{{ client.name }}</li>
  {{else}}
    <li>Nenhum cliente.</li>
  {{/each}}
</ul>
```

- `as client` cria a variável do item; `, index` (opcional) expõe a posição.
- `{{else}}` renderiza quando a lista está vazia (ou é `null`/`undefined`).
- Aceita arrays, `Map`, `Set`, strings e objetos simples (aí o "índice" é a
  chave).
- O laço é executado no servidor: pagine listas grandes.

## Layouts e blocos

Um template declara o layout e o conteúdo:

```html
{{> layouts/app title="Clientes"}}

{{#content "body"}}
  <h1>Clientes</h1>
  <p>Gerencie sua base.</p>
{{/content}}
```

```html
<!-- layouts/app.html -->
<!doctype html>
<html lang="pt-BR">
<head><title>{{ title }}</title></head>
<body>
  {{ body }}
</body>
</html>
```

- `{{#content "nome"}}` precisa ser **de nível superior**.
- O bloco é renderizado com o escopo do template e entregue ao layout como
  fragmento já seguro (por isso `{{ body }}` não escapa).
- Um bloco por nome; nomes duplicados geram erro.

## Includes

```html
{{> clients/list clients=clients}}
{{> partials/footer year=2026}}
```

- O include **herda** o escopo atual; propriedades explícitas têm precedência.
- Props aceitam expressões (`clients=clients.items`), literais entre aspas
  (`title="Clientes"`) ou booleanos (`compact`).
- Includes podem ser aninhados; profundidade máxima padrão: 32 (proteção contra
  ciclos).

## Atributos

Interpolação dentro de atributos é escapada no contexto de atributo (aspas,
`<`, `>`, `&` e crase):

```html
<a href="/clients/{{ client.id }}">Editar</a>
<button class="btn btn--{{ variant }}" data-id="{{ client.id }}">{{ label }}</button>
```

### Atributos booleanos

Quando o valor é **uma única expressão** e o atributo é booleano, o resultado é
`true` → atributo presente; `false`/`null`/`undefined` → atributo omitido:

```html
<input name="email" required="{{ required }}">
<button disabled="{{ saving }}">Salvar</button>
```

Atributos reconhecidos: `disabled`, `checked`, `selected`, `required`,
`readonly`, `hidden`, `multiple`, `autofocus`, `open`, `novalidate`, entre outros.

### URLs seguras

Em `href`, `src`, `action`, `formaction`, `poster`, `cite` e `data`, valores com
esquema `javascript:`, `vbscript:` ou `data:` não-imagem são substituídos por
`#`:

```html
<a href="{{ linkDoUsuario }}">Abrir</a><!-- javascript:... viraria # -->
```

Para validar manualmente use o helper `safeUrl()`.

### Passar todos os atributos (`{{ attrs }}`)

Dentro de uma tag é possível "espalhar" um objeto de atributos ou um fragmento
já renderizado:

```html
<div class="card" {{ attrs }}>...</div>
```

Isso é usado pelos componentes para repassar atributos do chamador.

## Comentários e defaults de componente

```html
{{! isto não aparece no HTML final }}
```

Comentários são removidos na renderização. Em componentes, o primeiro
comentário pode declarar **props padrão**:

```html
{{! defaults: {"type": "button", "variant": "primary"} }}
```

## Scripts, estilos e áreas de texto

- `<script>`: conteúdo **cru**. Nada é interpolado — JavaScript nunca recebe
  dados por template.
- `<style>`: aceita texto, `{{ expressão }}` e blocos (`{{#if}}`, `{{#each}}`).
  Valores interpolados são escapados para **contexto CSS**: apenas caracteres
  seguros sobrevivem (`letras`, `números`, `-`, `_`, `#`, `%`, `.`).
- `<textarea>` e `<title>`: aceitam interpolação, mas nenhuma tag.

Gerar CSS no servidor é útil para transições escalonadas e tokens dinâmicos:

```html
<style>
  {{#each items as item, index}}
  ::view-transition-new({{ vtName('row', item.id) }}) {
    animation-delay: {{ index * 35 }}ms;
  }
  {{/each}}
</style>
```

```html
<textarea name="notes">{{ client.notes }}</textarea>
```

## Escapes e contexto

| Contexto | Escape aplicado |
| --- | --- |
| texto | `& < > " ' \`` |
| valor de atributo | `& < > " ' \`` |
| bloco/fragmento do engine | nenhum (já é seguro) |
| `safeHtml()` | nenhum (explícito e documentado) |

Não existe `{{{ triplo }}}` — tentar usá-lo gera um erro que ensina a usar
`safeHtml()`.

## Modo estrito

Controlado por `createFlash({ strict })` (padrão: `dev`).

| Valor | Comportamento |
| --- | --- |
| `true` (dev) | identificador desconhecido **e** leitura em `null`/`undefined` lançam erro |
| `'full'` | também lança erro ao ler propriedade inexistente de um objeto existente |
| `false` (prod) | valores ausentes renderizam vazio |

Componentes são sempre renderizados de forma tolerante: props são opcionais por
natureza.

## Erros

Todo erro de template informa arquivo, linha e coluna:

```text
TemplateError: Mismatched closing tag </div>; <span> opened at line 4:5 is still open (clients/index.html:9:3)
```

## API relacionada

```js
import { parseTemplate, TemplateError, collectCapabilities } from 'flash';

const ast = parseTemplate('<h1>{{ title }}</h1>', { file: 'home.html' });
const ast2 = collectCapabilities(ast); // { directives, components, needsRuntime }
```
