---
title: Deploy
section: Servidor
description: flash_deploy — build de produção autocontido na pasta deploy/.
---

# Deploy

`flash_deploy` transforma o projeto em uma pasta **autocontida** pronta para
copiar ao servidor:

```bash
npm run flash_deploy
```

```text
  flash_deploy
  ─────────────────────────────────────────────
⌕ analyze   8 views, 8 componentes, 5 diretivas
▸ prepare   destino deploy
⌂ app       15 arquivos, 9 imports do framework reescritos
✦ css       compilado com Tailwind (26.2 kB)
# assets    1 assets com hash, 2 arquivos com referências atualizadas
◆ framework flash@0.1.0 vendorizado (42 arquivos, sem cli/, dev/panel.js)
↧ deps      65 pacotes copiados
☰ manifest  21 arquivos, 60 kB
✓ smoke     app respondeu 303 na porta 43083
  ─────────────────────────────────────────────
  pronto  deploy  (2.4s)

  verificação de produção
  ✓ raiz responde          303
  ✓ devtools desligado     404
  ✓ asset com hash         /assets/app.2a2b7bdd.css
  ✓ sem painel no HTML     ok
  ✓ CSP ativa              presente

  para rodar no servidor:
    cd deploy && node start.mjs
```

## O que entra na pasta

```text
deploy/
├── src/                  aplicação (imports do framework já reescritos)
├── public/               assets com hash de conteúdo
│   ├── app.2a2b7bdd.css
│   └── app.js
├── node_modules/
│   └── flash/            framework vendorizado (sem devtools)
├── package.json          dependências de produção
├── start.mjs             entrada que força NODE_ENV=production
├── README.md             como rodar
└── flash-manifest.json   versões, hashes e análise de templates
```

A pasta é **autocontida**: não depende do repositório, de bundler ou de
`npm install` no servidor.

## O passo a passo do comando

| Etapa | O que faz |
| --- | --- |
| `analyze` | varre as views e componentes, conta diretivas e componentes `ui:*` |
| `prepare` | valida o destino e limpa o deploy anterior |
| `app` | copia `src/` (sem `styles/`, sem testes) e reescreve os imports do framework |
| `css` | compila o Tailwind com `--minify` a partir de `src/styles/tailwind.css` |
| `assets` | renomeia CSS/imagens/fontes com hash e atualiza as referências |
| `framework` | copia o FLASH para `node_modules/flash` (sem `cli/` nem `dev/panel.js`) |
| `deps` | copia `express` + dependências transitivas |
| `manifest` | calcula SHA-256 de cada arquivo e grava o manifesto |
| `smoke` | sobe o app em produção, faz requisições e derruba |

## Imports reescritos

Um app dentro do repositório importa o framework por caminho relativo:

```js
import { createFlash } from '../../../src/index.js';
import { session } from '../../../src/adapters/session.js';
import { componentsDir } from '../../../src/paths.js';
```

O deploy reescreve para especificadores de pacote:

```js
import { createFlash } from 'flash/index.js';
import { session } from 'flash/adapters/session.js';
import { componentsDir } from 'flash/paths.js';
```

Isso vale para `import`, `export ... from` e `import()` dinâmico. Imports
relativos dentro da própria aplicação (`./routes/...`) não são tocados.

> Por isso o exemplo usa `componentsDir` de `flash/paths` em vez de montar o
> caminho até `src/ui` na mão — o mesmo código funciona nos dois cenários.

## CSS e assets

O CSS é recompilado a partir da fonte (`src/styles/tailwind.css`), não copiado do
`public/`. Depois disso:

- o arquivo vira `app.<hash>.css`;
- as views e componentes passam a apontar para o nome com hash;
- o `public/` do deploy contém apenas o resultado final.

Como o nome muda quando o conteúdo muda, o cache pode ser longo:

```js
if (isProduction) {
  flash.assets(path.join(ROOT, 'public'), { prefix: '/assets', immutable: true });
}
```

O deploy verifica isso: se o asset com hash não estiver sendo servido com cache
longo, ele avisa ao final.

## Rodando no servidor

```bash
# envie a pasta inteira
rsync -av --delete deploy/ servidor:/srv/app/

# no servidor
cd /srv/app
SESSION_SECRET="$(openssl rand -hex 32)" PORT=8080 node start.mjs
```

| Variável | Obrigatória | Observação |
| --- | --- | --- |
| `SESSION_SECRET` | **sim** | segredo forte e estável; sem ele as sessões caem a cada restart |
| `PORT` / `HOST` | não | padrão definido pela aplicação |

`start.mjs` existe por um motivo: ele define `NODE_ENV=production` **antes** de
carregar a aplicação.

```js
// start.mjs (gerado)
process.env.NODE_ENV = 'production';
await import('./src/app.js');
```

Rodar `node src/app.js` direto ligaria o modo de desenvolvimento — painel de
debug, templates revalidados, stack traces na página. Por isso o `package.json`
gerado só expõe `npm start` → `node start.mjs`.

## Verificação de produção

O passo `smoke` não é decorativo. Ele sobe o build e confirma:

| Checagem | Espera |
| --- | --- |
| raiz responde | status abaixo de 500 |
| devtools desligado | `404` em `/__flash/dev/stats.json` |
| asset com hash | `200` no arquivo renomeado |
| sem painel no HTML | nenhum `<script>` de `__flash/dev` |
| CSP ativa | `Content-Security-Policy` presente |

Se algo falhar, o comando termina com erro e o build não é considerado válido.

## Avisos automáticos

O deploy lê o código da aplicação e avisa sobre configurações perigosas:

```text
  avisos
  • src/app.js: usa `dev: true` fixo — em produção use `dev: false` ou NODE_ENV.
  • src/app.js: cookie de sessão com `secure: false` — ative atrás de HTTPS.
  • src/app.js: sessão sem `process.env.SESSION_SECRET`.
```

Avisos não interrompem o build: são decisões suas, mas ficam registradas no
manifesto.

## Opções

```bash
npm run flash_deploy -- --help
```

| Flag | Efeito |
| --- | --- |
| `--app <dir>` | aplicação de origem (padrão: `examples/clients-app`) |
| `--out <dir>` | destino (padrão: `deploy`) |
| `--entry <arquivo>` | ponto de entrada (padrão: `src/app.js`) |
| `--no-css` | não recompila o Tailwind; usa o `public/app.css` existente |
| `--no-bundle-deps` | não copia `node_modules`; rode `npm ci --omit=dev` no servidor |
| `--no-smoke` | não sobe o app ao final |
| `--no-clean` | falha se o destino já existir |
| `--force` | apaga o destino mesmo sem `flash-manifest.json` |
| `--dry-run` | mostra o plano sem escrever nada |
| `--json` | saída em JSON, para CI |

### Exemplos

```bash
# outro app do monorepo
node bin/flash-deploy.js --app examples/outra-app

# CI: sem copiar node_modules (o servidor instala)
node bin/flash-deploy.js --out dist --no-bundle-deps

# conferir o plano
node bin/flash-deploy.js --dry-run
```

## Segurança do destino

O comando **não apaga qualquer pasta**. Ele só remove o destino quando:

- a pasta está **vazia**, ou
- contém `flash-manifest.json` (ou seja, é um deploy anterior do FLASH), ou
- você passou `--force`.

```text
✖ "/srv/dados" existe e não parece um deploy do FLASH (sem flash-manifest.json).
Por segurança nada foi apagado. Use --force se tiver certeza.
```

## O manifesto

`flash-manifest.json` é o contrato do build:

```json
{
  "tool": "flash_deploy",
  "flash": { "version": "0.1.0" },
  "app": { "name": "flash-example-clients-deploy", "version": "1.0.0", "entry": "src/app.js" },
  "builtAt": "2026-10-29T22:39:12.845Z",
  "node": "v22.17.0",
  "environment": "production",
  "analysis": {
    "views": 8,
    "components": 8,
    "directives": ["f-bind:textContent", "f-confirm", "f-on:click", "f-submit", "f-target"],
    "componentTags": ["ui:badge", "ui:button", "ui:empty-state", "ui:field", "ui:modal", "ui:pagination", "ui:toast"],
    "needsRuntime": true
  },
  "assets": { "/assets/app.css": "/assets/app.2a2b7bdd.css" },
  "dependencies": { "direct": { "express": "5.3.0" }, "bundled": [ ] },
  "totals": { "files": 21, "bytes": 61064, "modulesFiles": 627, "allFiles": 648 },
  "warnings": [],
  "files": [{ "path": "src/app.js", "bytes": 3404, "sha256": "9f2c…" }]
}
```

Use-o para auditar o que foi publicado, comparar dois builds ou alimentar um
pipeline de verificação.

## Integração com CI

```yaml
- run: npm ci
- run: npm test
- run: npm run flash_deploy -- --json > deploy-report.json
- uses: actions/upload-artifact@v4
  with:
    name: flash-deploy
    path: deploy/
```

Sem `--no-bundle-deps` o artefato já vai com `node_modules` e não precisa de
`npm install` no servidor.

## Docker

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci && npm test && npm run flash_deploy

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/deploy/ ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "start.mjs"]
```

## O que **não** é feito

- Nada é publicado ou enviado por rede: o comando só escreve arquivos.
- Nenhuma migração de banco é executada.
- Minificação/compilação do JavaScript do servidor: o Node roda ES Modules
  nativamente.
- Geração de imagem Docker — veja o exemplo acima.

## Checklist

- [ ] `npm test` passando antes do build
- [ ] `SESSION_SECRET` definido no servidor
- [ ] `secure: true` nos cookies + HTTPS na frente
- [ ] avisos do deploy revisados
- [ ] `smoke` verde
- [ ] `flash-manifest.json` arquivado no release
- [ ] `deploy/` no `.gitignore` (é artefato, não código)
