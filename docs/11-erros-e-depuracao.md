---
title: Erros e depuração
section: Servidor
description: Como o FLASH reporta erros de template, de expressão e de HTTP.
---

# Erros e depuração

## Erros de template

Todo erro informa **arquivo, linha e coluna**:

```text
TemplateError: Unclosed {{#if}} opened at line 12:3 (clients/index.html:20:1)
TemplateError: Mismatched closing tag </div>; <section> opened at line 8:5 is still open (clients/list.html:14:3)
TemplateError: Invalid expression "user.": Unexpected end of expression (clients/form.html:23:11)
```

Erros comuns e como resolver:

| Mensagem | Causa |
| --- | --- |
| `Unclosed {{#if}}` | bloco sem `{{/if}}` |
| `Mismatched closing tag` | tag HTML fechada na ordem errada |
| `Triple braces are not supported` | use `safeHtml()` |
| `Only expressions are allowed between attributes` | `{{#if}}` dentro de uma tag |
| `Component "<ui:x>" not found` | arquivo `components/x.html` ausente |
| `Template "x" not found` | caminho errado em `views` |
| `não definido no contexto` | variável não passada ao `render` (modo estrito) |

### `{{#if}}` dentro de uma tag não é permitido

```html
<!-- ❌ -->
<input {{#if required}}required{{/if}}>

<!-- ✅ atributo booleano com expressão única -->
<input required="{{ required }}">

<!-- ✅ ou repita a tag -->
{{#if required}}<input required>{{else}}<input>{{/if}}
```

## Erros de expressão

```text
ExpressionError: "usuario" is not defined in the render context
ExpressionError: Cannot read "name" of null
ExpressionError: Access to "constructor" is not allowed
ExpressionError: "nome" is not a registered helper and cannot be called
ExpressionError: Expression is nested too deeply
```

- Em **dev** (`strict: true`) identificadores desconhecidos e leituras em
  `null` falham — é assim que erros de digitação aparecem rápido.
- Em **produção** valores ausentes renderizam vazio.
- Acessos a `__proto__`, `constructor` e `prototype` são sempre bloqueados.

## Erros HTTP

```js
throw new HttpError(404, 'Cliente não encontrado.');
throw notFound();
throw conflict('O registro foi alterado por outro usuário.');
throw new ValidationError({ email: 'E-mail inválido' });
```

- `status < 500` → mensagem visível ao usuário.
- `status >= 500` → mensagem genérica + `requestId`.

### Páginas de erro

Crie `views/errors/<status>.html` (ex.: `404.html`, `500.html`) e/ou
`views/errors/error.html` como fallback. Elas recebem:

| Prop | Conteúdo |
| --- | --- |
| `status` | código HTTP |
| `message` | mensagem (segura em produção) |
| `requestId` | identificador da requisição |
| `errors` | mapa de erros quando for `ValidationError` |
| `stack` | stack trace **apenas em dev** |
| `user`, `csrfToken`, `*ctx.locals` | contexto padrão |

Essas páginas são renderizadas de forma **tolerante**: um middleware que falhou
antes de preencher `ctx.locals` não impede a página de erro.

## Log

```js
const flash = createFlash({
  logger: {
    error(...args) { console.error(...args); }
  }
});
```

- **Dev:** `[flash] GET /clients failed (request <id>): <erro>` com stack.
- **Produção:** uma linha JSON com `requestId`, `method`, `path`, `status`,
  `name`, `message` — pronta para agregadores de log.

`X-Request-Id` é devolvido em toda resposta.

## Depuração rápida

```js
flash.get('/debug', async (ctx) => {
  return ctx.json({
    stats: flash.getStats(),
    routes: flash.routes()
  });
});
```

```js
// inspeciona templates sem subir o servidor
const report = await flash.analyze();
console.log(report.templates, report.directives, report.componentTags);
```

## Erros no navegador

| Sintoma | Onde olhar |
| --- | --- |
| diretiva não funciona | o atributo está exatamente `f-on:click`? |
| ação não roda | `console.warn: ação "x" não registrada` |
| região não atualiza | `console.warn: resposta recebida sem f-target` |
| `f-model` não reflete | caminho com ponto inválido |
| modal não abre | módulo `modal.js` não foi carregado |

## Regras de ouro

1. Nunca exponha stack traces em produção.
2. Sempre correlacione logs por `requestId`.
3. Não logue dados sensíveis: logue identificadores.
4. Erros de template são bugs de código, não comportamento esperado.
