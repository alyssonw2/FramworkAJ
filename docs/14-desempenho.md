---
title: Desempenho
section: Qualidade
description: Orçamento de JavaScript, cache de templates, assets e como medir.
---

# Desempenho

## Orçamento por página

| Recurso | Meta inicial |
| --- | --- |
| HTML inicial | conteúdo completo, sem tela vazia |
| JavaScript do framework | ~15 KB (runtime + diretivas) |
| JavaScript da aplicação | só os módulos usados |
| CSS | um arquivo, sem framework de CSS |
| Requisições | HTML + CSS + (runtime opcional) |

Números absolutos não substituem medição: meça **sua** aplicação.

## Onde o tempo é gasto

### Servidor

1. Router: casamento por regex, custo desprezível.
2. Templates: AST é cacheada; só há `stat` por template para invalidar em dev.
3. Renderização: concatenação de strings, sem DOM virtual.
4. `await` por componente/include (leitura de cache em memória).

Em produção use `freeze: true` (padrão fora de dev) e **nenhum** `stat` é feito
após o primeiro carregamento:

```js
const flash = createFlash({ dev: false, freeze: true });
```

### Cliente

- Um listener por tipo de evento (delegação).
- `refresh()` percorre o DOM aplicando diretivas — O(n) por atualização.
- Regiões grandes: prefira atualizar um subconjunto (`f-target` mais específico).

## Cache

```js
flash.get('/clients', async (ctx) => {
  const response = await ctx.render('clients/index', view);
  return response.header('Cache-Control', 'private, max-age=0, must-revalidate');
});
```

| Conteúdo | Política |
| --- | --- |
| assets com hash | `public, max-age=31536000, immutable` |
| runtime do framework | `max-age=3600` + `ETag` |
| HTML autenticado | `private, no-store` (ou `private, max-age=0`) |
| HTML público | `public, max-age=30` + validação |

Assets servidos pelo FLASH já enviam `ETag`/`Last-Modified` e respondem `304`.

## Paginação

Nunca renderize milhares de linhas. O padrão do exemplo é 8–25 itens por página,
com a paginação calculada no servidor.

## Transições

As View Transitions são compostas pelo navegador (transform/opacity), com custo
baixo. Cuidados:

- durações de 150–400ms;
- evite `filter: blur()` em áreas grandes — é a animação mais cara;
- não nomeie centenas de elementos com `view-transition-name` de uma vez: cada
  nome gera um snapshot próprio;
- o CSS de transições é um arquivo estático, cacheado com `ETag`.

## Compressão e CDN

- Ative Brotli/Gzip no proxy reverso (o FLASH não comprime).
- Coloque um CDN na frente de `/__flash/*` e `/assets/*`.
- Mantenha `Cache-Control` correto: o CDN respeita os cabeçalhos.

## Streaming

SSR com streaming está fora do MVP. Correção, escape e erros vêm primeiro; se
medições mostrarem TTFB alto por causa de templates grandes, avalie streaming
antes de otimizar prematuramente.

## Medindo

```js
// servidor: tempo de renderização
const start = performance.now();
const html = await flash.render('clients/index', view);
console.log('render ms:', (performance.now() - start).toFixed(1));
```

No navegador, use Performance API / Lighthouse / WebPageTest e acompanhe:

- TTFB, FCP, LCP, INP, CLS
- bytes de JS transferidos e **executados**
- número de nós do DOM
- custo de uma atualização parcial

## Benchmark justo

Compare com alternativas usando a **mesma** aplicação, mesmos dados, mesma
infraestrutura, mesmos caches, builds de produção e medições repetidas. Não
compare um protótipo sem otimização com um framework em produção.

```bash
# exemplo: 50 requisições sequenciais medindo latência
for i in $(seq 1 50); do curl -s -o /dev/null -w "%{time_total}\n" http://127.0.0.1:3000/clients; done | sort -n | tail -5
```

## Checklist

- [ ] `NODE_ENV=production` e `freeze: true`
- [ ] assets com `ETag` e `Cache-Control` corretos
- [ ] listas paginadas no servidor
- [ ] runtime carregado só onde há diretivas
- [ ] nenhuma dependência pesada no navegador
- [ ] medição registrada antes e depois de otimizar
