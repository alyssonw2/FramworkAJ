---
title: Acessibilidade e SEO
section: Qualidade
description: HTML semântico, foco, ARIA e o que o SSR entrega para buscadores.
---

# Acessibilidade e SEO

## A base é HTML semântico

Use os elementos nativos — eles já trazem comportamento e semântica:

```html
<button type="submit">Salvar</button>       <!-- ✅ -->
<div class="btn" role="button">Salvar</div> <!-- ❌ -->

<label for="email">E-mail</label>
<input id="email" name="email" type="email" required>

<nav aria-label="Principal">…</nav>
<main>…</main>
<table><caption>Clientes</caption>…</table>
```

## Formulários

`ui:field` já cuida do essencial:

- `<label for>` associado;
- `aria-required`;
- `aria-invalid` quando há erro;
- mensagem de erro com `role="alert"` ligada ao campo;
- `hint` opcional como texto auxiliar.

```html
<ui:field name="email" label="E-mail" type="email" required="{{ true }}"
          value="{{ form.email }}" error="{{ errors.email }}"
          hint="Usaremos apenas para contato."></ui:field>
```

## Foco e teclado

- Foco visível sempre (`:focus-visible` no CSS base).
- Modais: foco preso dentro do diálogo, `Escape` fecha, foco volta ao
  elemento que abriu (`modules/modal.js`).
- Nunca remova `outline` sem substituir por outra indicação.

## Regiões dinâmicas

Anuncie mudanças para leitores de tela:

```html
<section id="results" aria-live="polite">…</section>
```

Toasts usam `role="status"` (e `role="alert"` para erros).

## Movimento

Transições entre páginas são automáticas, mas nunca obrigatórias: o framework
desliga todas as animações quando o sistema pede menos movimento.

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) { animation: none !important; }
}
```

O runtime também consulta `prefers-reduced-motion` antes de abrir uma transição
same-document (troca de região), então o conteúdo aparece imediatamente.

Regras gerais:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
```

Já incluído em `flash.css`. Detalhes em
[Transições de página](/docs/transicoes-de-pagina).

## Tabelas

- `<th scope="col">` para cabeçalhos.
- `<caption>` (pode ser visualmente oculto).
- Ações por linha dentro de `<td>`, com rótulos claros.
- Em telas pequenas, evite esconder dados essenciais — o exemplo transforma
  linhas em blocos com rótulos.

## O framework não promete acessibilidade automática

Componentes precisam ser implementados e testados. Verifique com teclado,
leitor de tela (NVDA/VoiceOver) e zoom de 200%.

## SEO

Como o servidor entrega HTML completo:

- o conteúdo existe na primeira resposta;
- links são links reais e navegáveis;
- URLs funcionam sem JavaScript;
- títulos e metadados são renderizados por rota.

```html
<!-- layouts/app.html -->
<title>{{ title }} · Minha Empresa</title>
<meta name="description" content="{{ description }}">
<link rel="canonical" href="https://exemplo.com{{ currentPath }}">
```

Ainda é sua responsabilidade cuidar de:

- status HTTP correto (`200`, `404`, `410`, `301`);
- `robots.txt` e `sitemap.xml`;
- metadados sociais (Open Graph);
- dados estruturados (JSON-LD) quando aplicável;
- conteúdo duplicado e paginação indexável (`rel="prev"/"next"` ou `noindex`).

```js
flash.get('/sitemap.xml', async (ctx) => {
  const pages = await listPublicPages();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((page) => `  <url><loc>https://exemplo.com${page.path}</loc></url>`).join('\n')}
</urlset>`;

  return ctx.html(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
});
```

SSR ajuda, mas não garante posicionamento: conteúdo e experiência continuam
sendo os fatores principais.

## Checklist

- [ ] Elementos nativos e hierarquia de títulos correta
- [ ] Labels associados e erros acessíveis
- [ ] Foco visível e ordem de tabulação lógica
- [ ] `aria-live` em regiões atualizadas
- [ ] Contraste e zoom de 200%
- [ ] `prefers-reduced-motion` respeitado
- [ ] `title`, `description`, `canonical` e status corretos
- [ ] `robots.txt` e `sitemap.xml`
