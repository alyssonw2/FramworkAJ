---
title: Modo dev e devtools
section: Qualidade
description: Flag dev, painel de debug no navegador, endpoints de inspeção e overlay de erros.
---

# Modo dev e devtools

`createFlash({ dev: true })` — o padrão quando `NODE_ENV` não é `production` —
ativa um **serviço de desenvolvimento** que fica ativo enquanto o processo roda:

- painel de debug no navegador (badge + abas);
- endpoints de inspeção do servidor;
- overlay de erros no estilo do Vite;
- mensagens de erro de template mais detalhadas (`strict`);
- templates revalidados a cada requisição (sem reiniciar o servidor).

Nada disso existe em produção: com `dev: false` os endpoints não respondem e o
script não é injetado.

## Ligando e desligando

```js
const flash = createFlash({ views: './src/views' });          // dev por NODE_ENV
createFlash({ dev: true });                                   // força dev
createFlash({ dev: false });                                  // produção: sem painel
createFlash({ dev: true, devtools: false });                  // dev sem painel
```

No exemplo, a flag vem da linha de comando:

```bash
node examples/clients-app/src/app.js          # dev (padrão)
node examples/clients-app/src/app.js --dev    # explícito
node examples/clients-app/src/app.js --prod   # produção, sem devtools
```

## O painel

Ao abrir qualquer página em dev, um badge **FLASH** aparece no canto inferior
direito. Clique nele — ou use `Alt+Shift+D` — para abrir o painel.

| Aba | Mostra |
| --- | --- |
| **Requisições** | método, caminho, status, duração, tamanho, `requestId`, se foi fragmento e a transição usada; campo de filtro |
| **Rotas** | todas as rotas registradas + middlewares, templates, `strict`, transições e versão do Node |
| **Templates** | views e componentes já compilados, com as diretivas/componentes que cada um usa e um botão para limpar o cache |
| **Página** | `data-vt`, suporte a View Transitions, `prefers-reduced-motion`, nós do DOM, scripts, estado do cliente, ações registradas e quantas diretivas `f-*` existem |
| **Erros** | erros do navegador (com stack) e requisições 5xx do servidor |

O painel:

- vive em **Shadow DOM** — nenhum estilo da página entra nele, e vice-versa;
- atualiza sozinho a cada 2,5 s enquanto está aberto e a aba está visível;
- guarda a posição aberta/fechada por aba no `localStorage`;
- respeita `prefers-reduced-motion`;
- expõe `window.flashDevtools` (`open()`, `close()`, `toggle()`, `refresh()`,
  `snapshot`).

## Overlay de erros

Erros de runtime e promessas rejeitadas abrem um overlay com mensagem, origem,
stack e dois botões: **Fechar (Esc)** e **Recarregar**. `console.error` e
`console.warn` também são registrados na aba **Erros**, mas sem abrir o overlay.

```js
// dispara o overlay
setTimeout(() => { throw new Error('Falha ao carregar clientes'); }, 0);
```

Desligue apenas o overlay mantendo o registro:

```js
createFlash({ dev: true, devtools: { overlay: false } });
```

## Endpoints

Todos existem apenas em dev, respondem com `Cache-Control: no-store` e
`X-Robots-Tag: noindex`.

| Método | Caminho | Resposta |
| --- | --- | --- |
| `GET` | `/__flash/dev/stats.json` | snapshot completo do runtime |
| `POST` | `/__flash/dev/actions/clear-template-cache` | limpa o cache de templates |
| `POST` | `/__flash/dev/actions/clear-requests` | limpa o log de requisições |
| `GET` | `/__flash/dev/panel.js` | módulo do painel (asset) |

```bash
curl -s localhost:3000/__flash/dev/stats.json | jq '.counters, .app'

curl -X POST localhost:3000/__flash/dev/actions/clear-template-cache
```

Exemplo de snapshot:

```json
{
  "version": "0.1.0",
  "dev": true,
  "node": "v22.17.0",
  "uptimeMs": 192034,
  "process": { "rssMb": 82.4, "heapMb": 12.1 },
  "counters": { "requests": 128, "errors": 0, "fragments": 34, "requestsLogged": 80 },
  "app": { "routes": 13, "middlewares": 4, "templates": 11, "transitions": true, "strict": true },
  "routes": [{ "method": "GET", "path": "/clients" }],
  "templates": [{ "name": "clients/list", "kind": "view", "directives": ["f-submit"], "components": [] }],
  "requests": [{ "method": "GET", "path": "/clients?q=ana", "status": 200, "durationMs": 3.4 }]
}
```

Os endpoints são atendidos **antes** dos middlewares da aplicação, para que o
painel funcione mesmo quando tudo redireciona para `/login`. Isso também
significa que eles **não** passam por CSRF — por isso a regra: nunca habilite
devtools em produção.

## Configuração

```js
createFlash({
  dev: true,
  devtools: {
    requestLog: 80,             // quantas requisições guardar (máx. 500)
    overlay: true,              // overlay de erros
    shortcut: 'alt+shift+d',    // atalho para abrir/fechar
    position: 'bottom-right'    // ou 'bottom-left'
  }
});
```

`requestLog` só guarda as últimas N **requisições da aplicação**: as chamadas do
próprio painel são ignoradas para não poluir o log.

## O que muda no modo dev

| Item | Dev | Produção |
| --- | --- | --- |
| `strict` nas expressões | `true` (erros viram exceção) | `false` |
| cache de templates | revalida por `mtime` | congelado (`freeze: true`) |
| página de erro | mostra stack trace | mostra só o `requestId` |
| `Cache-Control` dos assets | `no-cache` | `max-age` + `ETag` |
| devtools | ativo | inexistente |

## Segurança

- O painel é servido **somente** quando `dev` está ativo; `dev: false` não expõe
  nem o script nem os endpoints.
- Se você habilitar `dev: true` em um servidor público, qualquer pessoa verá
  rotas, templates e o log de requisições. Mantenha dev na sua máquina.
- `NODE_ENV=production` mantém tudo desligado por padrão.

## Depurando com o painel

1. **Requisições**: confirme o status e o tempo; clique na linha não faz nada,
   mas o `title` mostra o `requestId` para cruzar com os logs do servidor.
2. **Requisições com `frag`**: a rota devolveu HTML parcial — é o esperado para
   `f-submit="ajax"`.
3. **Templates**: se um template não aparece, ele ainda não foi carregado;
   navegue até a tela correspondente.
4. **Página**: mostra `data-vt` e se o navegador suporta View Transitions.
5. **Erros**: requisições 5xx ficam vermelhas e contam no badge.

## No exemplo (Tailwind)

O app de exemplo usa **Tailwind CSS v4** e o painel já vem ligado:

```bash
npm run example       # http://127.0.0.1:3000  (devtools ativo)
npm run build:css     # recompila examples/clients-app/public/app.css
npm run watch:css     # build contínuo durante o desenvolvimento
```

O CSS do Tailwind é compilado a partir de
`examples/clients-app/src/styles/tailwind.css` (`@import "tailwindcss"` +
`@theme` + `@layer components`). O resultado é um arquivo estático — o navegador
não precisa de bundler nem de runtime do Tailwind.
