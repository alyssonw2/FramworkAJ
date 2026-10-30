---
title: Formulários e HTML parcial
section: Interatividade
description: Formulários que funcionam sem JavaScript e o contrato de atualização de regiões.
---

# Formulários e HTML parcial

Formulários são HTML. O aprimoramento AJAX é **opt-in**: o mesmo `form` funciona
com e sem JavaScript.

## Formulário tradicional

```html
<form method="POST" action="/clients">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">

  <label for="name">Nome</label>
  <input id="name" name="name" required>

  <label for="email">E-mail</label>
  <input id="email" name="email" type="email" required>

  <button type="submit">Salvar</button>
</form>
```

```js
flash.post('/clients', async (ctx) => {
  await createClient({ name: ctx.string('name'), email: ctx.string('email') });
  return ctx.redirect('/clients'); // 303 See Other
});
```

Sem JavaScript: o navegador envia o formulário, recebe o redirect e navega. Com
JavaScript mas **sem** `f-submit`: idêntico — o FLASH não intercepta nada.

## Aprimoramento opcional

```html
<form method="POST" action="/clients"
      f-submit="ajax"
      f-target="#client-list">
  …
</form>

<section id="client-list">…</section>
```

Com JavaScript:

1. o submit é interceptado;
2. `f-confirm` (se existir) é perguntado;
3. o corpo vai como `application/x-www-form-urlencoded`;
4. o cabeçalho `X-Flash-Request: fragment` é enviado;
5. a resposta atualiza `#client-list`;
6. o botão é desabilitado durante o envio (`aria-busy` no form).

Se a resposta for um redirect, o runtime **navega** em vez de trocar a região.

## O contrato da resposta

| Cabeçalho | Valores | Efeito no runtime |
| --- | --- | --- |
| `X-Flash-Request` (requisição) | `fragment` | o servidor sabe que pode responder só o trecho |
| `X-Flash-Update` | `replace` (padrão), `append`, `prepend`, `none` | como aplicar o HTML |
| `X-Flash-Target` | seletor CSS | sobrescreve o alvo do formulário |
| `X-Flash-Redirect` | URL | navega (usado no lugar do 303) |

O servidor decide o formato:

```js
flash.post('/clients/:id/delete', async (ctx) => {
  await deleteClient(ctx.params.id);

  if (ctx.wantsFragment()) {
    const view = await listViewModel(ctx);
    return ctx.fragment('clients/list', { ...view, toast: { tone: 'success', message: 'Excluído.' } });
  }

  return ctx.redirect('/clients');
});
```

### Por que `X-Flash-Redirect`?

Um `303` seguido automaticamente pelo `fetch` devolveria a página inteira para
dentro de uma região. Por isso, em requisições de fragmento, `ctx.redirect()`
responde `200` com `X-Flash-Redirect` — o runtime então navega:

```js
// no controller, nada muda:
return ctx.redirect('/clients');
```

## Erros de validação

Devolva o formulário com `422` e os erros por campo:

```js
try {
  await createClient(input);
} catch (error) {
  if (error instanceof ValidationError) {
    return ctx.render('clients/form', { form: input, errors: error.errors }, { status: 422 });
  }
  throw error;
}
```

```html
<ui:field name="email" label="E-mail" value="{{ form.email }}" error="{{ errors.email }}"></ui:field>
```

`ui:field` já marca `aria-invalid`, aplica a classe de erro e associa a mensagem
ao campo. Em modo fragmento, o runtime troca a região com o formulário
re-renderizado e o foco permanece na tela.

## Indicação de carregamento

O runtime marca o formulário com `aria-busy="true"` e desabilita o botão
submetido. Estilize como quiser:

```css
form[aria-busy="true"] { opacity: .7; }
```

## Uploads de arquivo

`f-submit="ajax"` envia `application/x-www-form-urlencoded` e **não** suporta
`<input type="file">`. Para uploads, use o formulário tradicional (o navegador
faz o streaming multipart) ou uma chamada `fetch` própria com `FormData`.

## CSRF

Toda mutação autenticada por cookie precisa do token:

```html
<input type="hidden" name="_csrf" value="{{ csrfToken }}">
```

- `csrfToken` é injetado automaticamente em `ctx.render`/`ctx.fragment`.
- O runtime envia o token junto com o corpo do formulário.
- Também é aceito no cabeçalho `X-CSRF-Token` (útil em chamadas próprias).

Veja [Sessões e CSRF](/docs/sessoes-e-csrf).

## Idempotência e duplo clique

O runtime bloqueia envios concorrentes do mesmo formulário. No servidor:

- use `POST` + redirect (padrão) para evitar reenvio ao recarregar;
- para operações financeiras, adicione uma chave de idempotência enviada no
  formulário e validada no servidor;
- valide concorrência (`UPDATE ... WHERE version = ?`) e use transações.

## Navegação

O MVP **não intercepta links**. Links continuam sendo links reais — acessíveis,
indexáveis e com abertura em nova aba funcionando. Se você quiser navegação
parcial, implemente um alvo explícito com `f-submit="ajax"` em formulários GET
como no exemplo abaixo:

```html
<form method="GET" action="/clients" f-submit="ajax" f-target="#results">
  <input name="q" value="{{ search }}">
  <button>Buscar</button>
</form>
```

## Checklist

- [ ] O formulário funciona com JavaScript desabilitado?
- [ ] O servidor valida todos os campos novamente?
- [ ] A resposta é redirect, HTML parcial ou JSON — nunca "tudo" ao mesmo tempo?
- [ ] O alvo da atualização é explícito?
- [ ] CSRF está presente em toda mutação?
