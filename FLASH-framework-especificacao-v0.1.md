# FLASH --- Framework HTML-First para Aplicações Server-Rendered

> **Slogan:** Escreva menos. Entregue HTML. Envie só o JavaScript
> necessário.\
> **Nome:** FLASH\
> **Expansão sugerida:** *Fast Lightweight Application Server-rendered
> HTML*\
> **Status deste documento:** especificação de produto e arquitetura ---
> versão 0.1 (proposta)\
> **Stack de referência:** Node.js 24+, JavaScript ES Modules, Express
> (adaptável a outros servidores)

------------------------------------------------------------------------

## 1. Visão geral

FLASH é um framework full-stack, HTML-first e server-rendered, projetado
para construir sistemas administrativos, CRUDs, painéis, CRMs, ERPs,
PDVs e aplicações SaaS com o mínimo de código repetitivo possível.

A aplicação é descrita principalmente em HTML declarativo. O servidor
resolve rotas, carrega dados, executa regras de negócio, renderiza
templates e entrega HTML pronto. No navegador, um runtime pequeno
adiciona interações locais e aprimoramentos progressivos. O JavaScript
enviado deve ser limitado às capacidades realmente utilizadas pela
página.

FLASH **não pretende ser um substituto universal de React, Vue ou
Angular**. Seu foco é reduzir o custo de desenvolvimento e manutenção de
aplicações orientadas a dados, formulários, tabelas e fluxos de negócio.

### 1.1 Princípios fundamentais

1.  **HTML primeiro:** a estrutura e a semântica da interface ficam em
    HTML.
2.  **Servidor como renderizador inicial:** a primeira resposta contém
    conteúdo utilizável, não uma tela vazia esperando JavaScript.
3.  **JavaScript sob demanda:** enviar apenas o runtime e os módulos
    necessários.
4.  **Progressive enhancement:** a interface deve continuar utilizável
    sem JavaScript sempre que isso for viável.
5.  **DOM real:** atualizar nós específicos; não adotar Virtual DOM no
    MVP.
6.  **Poucas abstrações:** diretivas pequenas, explícitas e
    consistentes.
7.  **Regras de negócio no servidor:** o cliente nunca é autoridade para
    permissões, preços, estoque ou validações críticas.
8.  **Escape por padrão:** valores interpolados em HTML são escapados
    automaticamente.
9.  **Sem `eval` ou `new Function`:** expressões declarativas são
    analisadas por um parser restrito.
10. **Simplicidade verificável:** cada recurso precisa justificar seu
    custo em complexidade.

### 1.2 O que FLASH não é

-   Não é uma SPA por padrão.
-   Não é um compilador de JavaScript para HTML.
-   Não é um substituto de Node.js ou Express.
-   Não é um sistema de componentes que exige transformar tudo em
    componentes.
-   Não é uma API para escrever toda a lógica de negócio em atributos
    HTML.
-   Não promete ser mais rápido que qualquer framework em todos os
    cenários.
-   Não promete eliminar código: busca eliminar repetição e centralizar
    comportamentos comuns.

------------------------------------------------------------------------

## 2. Público e casos de uso

### 2.1 Casos prioritários

-   Sistemas administrativos e painéis internos.
-   CRUDs com pesquisa, filtros, paginação e formulários.
-   CRM, ERP e sistemas de gestão.
-   PDV web e aplicações operacionais.
-   Portais autenticados.
-   Catálogos, páginas públicas e landing pages renderizadas no
    servidor.
-   SaaS com múltiplas organizações e permissões.

### 2.2 Casos não prioritários

-   Jogos e interfaces WebGL.
-   Editores gráficos complexos.
-   Aplicações com interações locais intensas e estado altamente
    distribuído.
-   Ferramentas que dependem fortemente de ecossistema React/Vue.
-   Aplicações offline-first complexas com sincronização bidirecional
    sofisticada.

Esses cenários podem integrar JavaScript convencional ou outra
biblioteca sem obrigar o núcleo FLASH a suportá-los nativamente.

------------------------------------------------------------------------

## 3. Modelo mental

O modelo de execução é dividido em duas partes:

  -----------------------------------------------------------------------
  Servidor                            Navegador
  ----------------------------------- -----------------------------------
  Roteamento e autenticação           Interações locais

  Autorização e regras de negócio     Abrir/fechar modal

  Acesso a banco e serviços           Tabs e dropdowns

  Renderização HTML inicial           Máscaras e feedback visual

  Validação definitiva                Validação imediata de UX

  Paginação e filtros de dados        Estado temporário de formulário

  Respostas HTML completas ou         Atualização de regiões específicas
  parciais                            
  -----------------------------------------------------------------------

**Regra:** o servidor é a autoridade do estado de negócio. O navegador
mantém apenas estado transitório de interface e apresenta os resultados
retornados pelo servidor.

### 3.1 Ciclo de uma requisição

``` text
Navegador
   |
   | GET /clientes
   v
Router
   |
   v
Middleware (sessão, autenticação, autorização)
   |
   v
Controller
   |
   v
Service / Repository
   |
   v
Dados
   |
   v
View Model
   |
   v
Template Engine
   |
   v
HTML final
   |
   v
Resposta HTTP
```

### 3.2 Ciclo de uma interação

``` text
Usuário clica em "Excluir"
   |
   v
Runtime FLASH intercepta a ação
   |
   v
Confirmação opcional
   |
   v
Requisição DELETE/POST ao servidor
   |
   v
Autenticação + autorização + validação
   |
   v
Service executa a operação
   |
   v
Servidor retorna HTML parcial ou redirecionamento
   |
   v
Runtime atualiza a região ou navega
```

------------------------------------------------------------------------

## 4. Arquitetura de alto nível

``` text
flash/
├── server/
│   ├── app.js
│   ├── router.js
│   ├── request-context.js
│   ├── middleware.js
│   ├── controller.js
│   └── response.js
├── view/
│   ├── loader.js
│   ├── parser.js
│   ├── compiler.js
│   ├── renderer.js
│   ├── expressions.js
│   ├── escaping.js
│   ├── components.js
│   └── cache.js
├── client/
│   ├── runtime.js
│   ├── actions.js
│   ├── forms.js
│   ├── navigation.js
│   ├── targets.js
│   └── modules/
├── ui/
│   ├── table/
│   ├── modal/
│   ├── toast/
│   ├── pagination/
│   └── form/
├── adapters/
│   ├── express.js
│   └── database/
├── build/
│   ├── analyzer.js
│   ├── bundler.js
│   └── manifest.js
└── index.js
```

A estrutura acima é uma separação conceitual. A implementação inicial
deve permanecer menor: não criar módulos vazios só para seguir a árvore.

### 4.1 Camadas

-   **HTTP adapter:** integração com Express ou servidor compatível.
-   **Router:** mapeia método e caminho para handlers.
-   **Middleware:** sessão, autenticação, autorização, CSRF, logging e
    tratamento de erros.
-   **Controller:** traduz a requisição em uma operação e escolhe a
    resposta.
-   **Service:** regras de negócio.
-   **Repository:** persistência.
-   **View engine:** carrega, compila e renderiza templates.
-   **Client runtime:** interações declarativas e atualização de
    regiões.
-   **Build tool:** identifica recursos usados e produz assets
    otimizados.

------------------------------------------------------------------------

## 5. Sintaxe HTML

A sintaxe deve ser curta, previsível e limitada. Atributos `f-*` são
reservados ao framework.

### 5.1 Interpolação de texto

``` html
<h1>Olá, {{ user.name }}</h1>
<p>Você possui {{ orders.length }} pedidos.</p>
```

-   A interpolação em contexto de texto é escapada.
-   Não permitir HTML arbitrário por interpolação.
-   Para conteúdo HTML confiável, exigir uma API explícita e
    documentada, como `safeHtml()`, nunca uma interpolação comum.
-   Propriedades inexistentes devem gerar erro em desenvolvimento e
    comportamento controlado em produção.

### 5.2 Condição no servidor

``` html
{{#if user}}
  <p>Bem-vindo, {{ user.name }}.</p>
{{else}}
  <a href="/login">Entrar</a>
{{/if}}
```

O bloco é resolvido no servidor. O navegador recebe somente o HTML
resultante.

### 5.3 Repetição no servidor

``` html
<table>
  <tbody>
    {{#each clients as client}}
      <tr>
        <td>{{ client.name }}</td>
        <td>{{ client.email }}</td>
      </tr>
    {{/each}}
  </tbody>
</table>
```

A repetição ocorre no servidor. Para listas grandes, usar paginação; não
renderizar milhares de registros sem necessidade.

### 5.4 Layouts e inclusão

``` html
{{> layouts/app title="Clientes"}}

{{#content "body"}}
  <h1>Clientes</h1>
  <p>Gerencie seus clientes.</p>
{{/content}}
```

A sintaxe final de layouts e blocos deve ser validada em protótipo. A
especificação não deve ser considerada API estável antes dos testes.

### 5.5 Componentes

``` html
<ui:button variant="primary" type="submit">
  Salvar
</ui:button>
```

Componentes são templates reutilizáveis renderizados no servidor.
Preferir tags com namespace (`ui:`) para evitar colisões com elementos
HTML nativos.

Exemplo conceitual de componente:

``` html
<!-- components/button.html -->
<button class="btn btn-{{ variant }}" type="{{ type }}">
  {{ slot }}
</button>
```

Requisitos: - Props tipadas/validadas quando possível. - Slots com
escape e regras explícitas. - Sem estado oculto desnecessário. -
Componentes devem aceitar atributos HTML padrão. - Componentes
interativos podem incluir um módulo client-side específico.

### 5.6 Templates HTML nativos

A tag nativa `<template>` continua disponível para conteúdo que precisa
ser clonado no navegador:

``` html
<template id="client-row">
  <tr>
    <td data-field="name"></td>
    <td data-field="email"></td>
  </tr>
</template>
```

FLASH não deve confundir templates de renderização do servidor com a tag
nativa. São recursos diferentes: - **Template FLASH:** processado no
servidor. - **`<template>` HTML:** permanece inerte no DOM até ser
clonado pelo JavaScript.

------------------------------------------------------------------------

## 6. Diretivas client-side

Diretivas são reservadas a interações locais simples. Não devem se
transformar em uma linguagem de negócio.

### 6.1 Conjunto inicial

  Diretiva       Responsabilidade                Exemplo
  -------------- ------------------------------- ---------------------------------
  `f-on:click`   Evento local                    `f-on:click="modal.open"`
  `f-show`       Visibilidade                    `f-show="menuOpen"`
  `f-model`      Vincular campo a estado local   `f-model="search"`
  `f-bind:`      Atributo DOM seguro             `f-bind:disabled="saving"`
  `f-class`      Classe condicional              `f-class="active: selected"`
  `f-target`     Região a atualizar              `f-target="#results"`
  `f-confirm`    Confirmação simples             `f-confirm="Excluir registro?"`

Exemplo:

``` html
<button f-on:click="menu.toggle">Menu</button>

<nav f-show="menu.open">
  <a href="/clientes">Clientes</a>
</nav>

<input f-model="search" placeholder="Pesquisar">
```

### 6.2 Limites das expressões

Não aceitar JavaScript arbitrário em atributos. O parser deve suportar
somente: - identificadores permitidos; - acesso a propriedades; -
literais de string, número, booleano e `null`; - comparações e
operadores lógicos explicitamente documentados; - chamadas a ações
registradas no contexto.

Não suportar: - `eval`; - `new Function`; - acesso livre a `window`,
`document`, `process` ou `globalThis`; - execução de código fornecido
pelo usuário; - chamadas arbitrárias a funções globais.

### 6.3 Ações registradas

``` js
flash.client({
  actions: {
    'menu.toggle'({ state }) {
      state.menu.open = !state.menu.open;
    }
  },
  state: {
    menu: { open: false }
  }
});
```

O estado client-side é local à página ou ao escopo configurado. Não deve
ser confundido com estado persistente ou autorizado do servidor.

------------------------------------------------------------------------

## 7. Formulários e mutações

Formulários devem funcionar sem JavaScript sempre que possível.

### 7.1 Formulário HTML padrão

``` html
<form method="POST" action="/clients">
  <label>
    Nome
    <input name="name" required>
  </label>

  <label>
    E-mail
    <input name="email" type="email" required>
  </label>

  <button type="submit">Salvar</button>
</form>
```

O servidor valida novamente todos os campos. Validação HTML/JavaScript é
apenas uma melhoria de experiência.

### 7.2 Aprimoramento opcional

``` html
<form method="POST"
      action="/clients"
      f-submit="ajax"
      f-target="#client-list">
  ...
</form>
```

Com JavaScript, o runtime envia a requisição e atualiza `#client-list`.
Sem JavaScript, o navegador envia o formulário normalmente e recebe uma
resposta HTML completa.

### 7.3 Respostas

O framework deve padronizar três resultados: 1. **Redirect:** navegação
após sucesso em formulário tradicional. 2. **HTML parcial:** fragmento
para atualizar uma região. 3. **JSON:** integração explícita com
clientes externos ou aplicações que realmente precisem de JSON.

Não transformar toda resposta automaticamente em JSON.

### 7.4 CSRF

Toda mutação autenticada por cookie deve ter proteção CSRF: - token
associado à sessão; - validação no servidor; - cookies `SameSite`
apropriados; - proteção também em requisições AJAX; - nunca confiar
apenas em checagem de `Origin`.

### 7.5 Idempotência e duplicidade

Para operações financeiras ou sensíveis: - suportar chave de
idempotência; - bloquear submissões duplicadas no cliente como
conveniência; - validar duplicidade e concorrência no servidor; - usar
transações no banco.

------------------------------------------------------------------------

## 8. Atualização parcial de HTML

A atualização parcial é uma capacidade central, mas deve ter contrato
simples.

### 8.1 Exemplo

``` html
<form method="GET"
      action="/clients"
      f-submit="ajax"
      f-target="#results">
  <input name="q" placeholder="Buscar clientes">
  <button>Buscar</button>
</form>

<section id="results">
  <!-- lista renderizada no servidor -->
</section>
```

O servidor pode responder com um fragmento HTML destinado à região
`#results`.

### 8.2 Regras

-   O alvo deve ser explícito.
-   A resposta deve declarar o tipo de atualização.
-   O runtime deve substituir somente o alvo autorizado.
-   Scripts recebidos em fragmentos não devem ser executados
    automaticamente.
-   Eventos devem ser delegados pelo runtime ou inicializados de forma
    idempotente.
-   Não inserir HTML não confiável.
-   Se a região não existir, registrar erro controlado e preservar a
    página.

### 8.3 Estratégia de navegação

Para navegação interna: - usar links HTML reais; - interceptar apenas
links elegíveis; - respeitar abrir em nova aba, download, modificadores
e links externos; - atualizar histórico com `history.pushState`; -
manter fallback para navegação tradicional; - tratar voltar/avançar do
navegador.

O MVP pode começar sem navegação interceptada. Primeiro implementar
formulários e regiões parciais.

------------------------------------------------------------------------

## 9. Renderização no servidor

### 9.1 Pipeline

1.  Resolver a rota.
2.  Executar middlewares.
3.  Validar autenticação e autorização.
4.  Executar controller/service.
5.  Construir um view model serializável.
6.  Carregar template compilado.
7.  Resolver componentes e blocos.
8.  Escapar valores conforme o contexto.
9.  Renderizar HTML.
10. Incluir referências a assets.
11. Enviar resposta com status e headers corretos.

### 9.2 Compilação de templates

Templates devem ser compilados para funções internas seguras e
armazenados em cache em produção.

Não usar `eval` nem `new Function` para compilar templates. Opções: -
parser próprio que constrói uma AST; - interpretador da AST; -
compilador que gera módulos JavaScript estáticos durante o build, sem
execução dinâmica em runtime.

A escolha deve privilegiar segurança e facilidade de auditoria, não
micro-otimização prematura.

### 9.3 Cache

-   Cachear AST/template compilado em produção.
-   Não compartilhar cache de HTML entre usuários autenticados sem chave
    e política corretas.
-   Assets estáticos podem usar hash e cache longo.
-   Conteúdo personalizado deve usar headers adequados (`private`,
    `no-store` quando necessário).
-   Invalidar cache quando templates ou componentes mudarem.

### 9.4 Streaming

Streaming SSR pode ser avaliado depois. Não é requisito do MVP. Primeiro
garantir renderização correta, escape, erros e compatibilidade.

------------------------------------------------------------------------

## 10. Runtime do navegador

O runtime deve ser pequeno e opcional.

### 10.1 Responsabilidades

-   Delegação de eventos.
-   Estado local mínimo.
-   Diretivas declarativas.
-   Envio aprimorado de formulários.
-   Atualização de regiões.
-   Feedback de carregamento.
-   Navegação aprimorada opcional.
-   Inicialização de módulos de componentes.

### 10.2 Delegação de eventos

Preferir poucos listeners globais por tipo de evento em vez de adicionar
um listener por elemento. Isso reduz memória e simplifica descarte de
nós.

### 10.3 Estado reativo

Não implementar um sistema reativo universal no primeiro release. Para o
MVP: - estado local explícito; - atualização por ações; - renderização
local apenas do que depende desse estado; - sem watchers globais ou
dependências implícitas complexas.

Um Proxy pode ser usado internamente, mas deve ser testado para arrays,
objetos aninhados, substituição de referências e limpeza de
dependências. Não assumir que Proxy, por si só, resolve atualização
granular.

### 10.4 Ciclo de vida de elementos

Quando um fragmento é substituído: - remover referências a nós
antigos; - cancelar listeners e observers associados; - inicializar
diretivas novas uma única vez; - evitar memory leaks; - não executar
scripts do fragmento.

------------------------------------------------------------------------

## 11. Componentes de UI

FLASH pode oferecer componentes opcionais para acelerar interfaces
administrativas.

### 11.1 Componentes candidatos

-   `ui:button`
-   `ui:input`
-   `ui:select`
-   `ui:modal`
-   `ui:toast`
-   `ui:table`
-   `ui:pagination`
-   `ui:badge`
-   `ui:dropdown`
-   `ui:tabs`
-   `ui:empty-state`
-   `ui:loading`

### 11.2 Tabelas

Uma tabela deve aceitar: - colunas declaradas; - dados paginados pelo
servidor; - ordenação validada no servidor; - pesquisa; - ações por
linha; - estados vazios e de carregamento; - acessibilidade por
teclado; - versão responsiva.

Não permitir que o atributo `resource="/clients"` execute
automaticamente operações sem configuração explícita de autorização,
validação e contrato.

### 11.3 CRUD declarativo

Exemplo conceitual:

``` html
<ui:crud
  resource="clients"
  list="/clients"
  create="/clients"
  update="/clients/:id"
  delete="/clients/:id">
  <ui:field name="name" label="Nome" required />
  <ui:field name="email" label="E-mail" type="email" required />
</ui:crud>
```

Este é um componente de alto nível, não uma promessa de CRUD mágico. O
servidor ainda precisa definir handlers, autorização, validação, regras
de negócio e persistência.

Uma configuração de CRUD não pode substituir controle de acesso ou expor
automaticamente todas as colunas do banco.

------------------------------------------------------------------------

## 12. API pública proposta

A API deve ser pequena e consistente. Exemplo ilustrativo:

``` js
import { createFlash } from '@flash/core';
import { expressAdapter } from '@flash/express';

const flash = createFlash({
  views: './src/views',
  components: './src/components',
  assets: './public'
});

flash.get('/clients', async (ctx) => {
  const clients = await clientService.list({
    query: ctx.query.q,
    page: ctx.query.page
  });

  return ctx.render('clients/index', {
    clients,
    title: 'Clientes'
  });
});

flash.post('/clients', async (ctx) => {
  await clientService.create(ctx.body);
  return ctx.redirect('/clients');
});

app.use(expressAdapter(flash));
```

A API exata deve ser validada por protótipo. O exemplo define a
intenção, não uma implementação já existente.

### 12.1 Contexto da requisição

`ctx` deve expor somente capacidades documentadas: - `ctx.params` -
`ctx.query` - `ctx.body` - `ctx.session` - `ctx.user` - `ctx.request` -
`ctx.render()` - `ctx.redirect()` - `ctx.html()` - `ctx.json()` -
`ctx.status` - `ctx.headers`

Não expor objetos globais mutáveis compartilhados entre requisições.

------------------------------------------------------------------------

## 13. Organização de um projeto FLASH

``` text
my-app/
├── src/
│   ├── app.js
│   ├── routes/
│   │   ├── clients.routes.js
│   │   └── auth.routes.js
│   ├── controllers/
│   ├── services/
│   ├── repositories/
│   ├── views/
│   │   ├── layouts/
│   │   ├── clients/
│   │   └── auth/
│   ├── components/
│   ├── client/
│   │   ├── app.js
│   │   └── modules/
│   └── styles/
├── public/
│   └── assets/
├── tests/
├── package.json
└── flash.config.js
```

Separação recomendada: - Controllers coordenam HTTP. - Services contêm
regras de negócio. - Repositories isolam banco de dados. - Views exibem
dados; não executam regras de negócio. - Client modules tratam
comportamento de interface. - Componentes não acessam banco diretamente.

------------------------------------------------------------------------

## 14. Segurança

Segurança é requisito do núcleo, não um plugin opcional.

### 14.1 XSS

-   Escape automático por contexto.
-   `textContent` para inserir texto no cliente.
-   Não interpolar valores em atributos sem escape contextual.
-   Não executar scripts vindos de HTML parcial.
-   API explícita e restrita para HTML confiável.
-   Política CSP recomendada.
-   Sanitização não substitui escape contextual.

### 14.2 Injeção de expressão

-   Parser restrito.
-   Sem `eval`/`new Function`.
-   Sem acesso a objetos globais.
-   Sem execução de expressões fornecidas por usuários.
-   Limites de profundidade e tamanho para expressões/templates.

### 14.3 CSRF e sessão

-   Tokens CSRF em mutações.
-   Cookies `HttpOnly`, `Secure` em HTTPS e `SameSite`.
-   Rotação de sessão após login e mudança de privilégio.
-   Expiração e invalidação no logout.
-   Rate limiting em autenticação e endpoints sensíveis.

### 14.4 Autorização

-   Autorização no servidor em toda operação.
-   Não confiar em botões ocultos ou diretivas client-side.
-   Verificar organização/tenant em todas as consultas multi-tenant.
-   Impedir IDOR com autorização por recurso.
-   Auditar operações críticas.

### 14.5 Dados e headers

-   Validar entradas no servidor.
-   Usar queries parametrizadas/ORM.
-   Definir limites de body e upload.
-   Configurar headers de segurança.
-   Não expor stack traces em produção.
-   Não serializar segredos, tokens ou dados privados no HTML inicial.

### 14.6 Dependências e supply chain

-   Manter dependências mínimas.
-   Fixar versões e usar lockfile.
-   Auditar dependências.
-   Gerar SBOM em releases quando viável.
-   Revisar scripts de instalação e build.

------------------------------------------------------------------------

## 15. Performance e orçamento

Não declarar metas numéricas sem medições. O projeto deve estabelecer
budgets depois de protótipos e benchmarks reproduzíveis.

### 15.1 Estratégias

-   HTML inicial renderizado no servidor.
-   Runtime client-side opcional.
-   Importação dinâmica por componente.
-   Bundles separados por página.
-   Cache de templates compilados.
-   Compressão Brotli/Gzip.
-   Assets com hash e cache longo.
-   Paginação no servidor.
-   Delegação de eventos.
-   Atualização apenas de regiões necessárias.
-   Evitar dependências pesadas no núcleo.

### 15.2 Métricas

Medir em aplicações de referência: - tamanho do HTML; - JavaScript
transferido e executado; - CSS transferido; - tempo de resposta do
servidor; - TTFB, FCP e LCP; - INP; - memória no navegador; - tempo de
renderização de listas; - quantidade de nós DOM; - custo de atualização
parcial.

### 15.3 Benchmark justo

Comparar FLASH com alternativas usando: - mesma aplicação; - mesmos
dados; - mesma infraestrutura; - mesma estratégia de cache; - builds de
produção; - medições repetidas; - métricas de transferência e execução
separadas.

Não comparar um protótipo sem otimização com um framework em produção e
tirar conclusões gerais.

------------------------------------------------------------------------

## 16. Acessibilidade

O HTML semântico é a base.

Requisitos: - usar elementos nativos (`button`, `form`, `label`,
`table`, `nav`); - associar labels aos campos; - foco visível; -
navegação por teclado; - mensagens de erro associadas aos campos; -
`aria-live` para feedback dinâmico quando necessário; - modais com foco
gerenciado e retorno de foco; - não usar `div` como controle interativo
sem necessidade; - respeitar `prefers-reduced-motion`; - testar com
leitores de tela.

O framework não pode prometer acessibilidade automática. Componentes
precisam ser implementados e testados corretamente.

------------------------------------------------------------------------

## 17. SEO e páginas públicas

Como o servidor entrega HTML completo: - conteúdo principal existe no
HTML inicial; - títulos e metadados podem ser renderizados por rota; -
URLs são navegáveis diretamente; - links são links reais; - páginas
podem funcionar sem JavaScript.

Ainda é necessário cuidar de: - status HTTP correto; - canonical; -
sitemap; - robots; - metadados sociais; - dados estruturados quando
aplicável; - conteúdo duplicado; - paginação indexável conforme
estratégia do site.

SSR ajuda, mas não garante posicionamento em buscadores.

------------------------------------------------------------------------

## 18. Testes

### 18.1 Testes unitários

-   parser de templates;
-   parser de expressões;
-   escape por contexto;
-   renderização de blocos;
-   resolução de componentes;
-   validação de props;
-   registro de ações;
-   seleção de alvos.

### 18.2 Testes de integração

-   rota com sessão;
-   autorização;
-   renderização de página;
-   envio de formulário;
-   resposta parcial;
-   redirect;
-   CSRF;
-   erro de service;
-   cache de templates.

### 18.3 Testes end-to-end

-   primeira carga sem JavaScript;
-   formulário tradicional;
-   formulário aprimorado;
-   atualização parcial;
-   histórico do navegador;
-   modal e foco;
-   perda de conexão;
-   duplo clique;
-   sessão expirada;
-   acesso negado.

### 18.4 Testes de segurança

-   XSS em texto e atributos;
-   tentativas de injeção em expressões;
-   CSRF;
-   IDOR;
-   tenant leakage;
-   HTML parcial malicioso;
-   prototype pollution;
-   upload indevido;
-   abuso de endpoints.

------------------------------------------------------------------------

## 19. Tratamento de erros

O framework deve padronizar: - erro de template com arquivo e posição; -
erro de expressão com contexto seguro; - erro de componente com nome e
props; - erro HTTP com status; - erro de atualização parcial; - erro de
runtime client-side.

Em produção: - não mostrar stack trace ao usuário; - registrar
correlation/request ID; - logar contexto sem dados sensíveis; - retornar
página de erro ou fragmento apropriado; - preservar logs estruturados.

------------------------------------------------------------------------

## 20. Build e entrega de JavaScript

### 20.1 Objetivo

O servidor pode renderizar HTML sem que a página precise carregar o
runtime completo. O build deve gerar um manifesto de módulos e assets.

### 20.2 Estratégia progressiva

**Fase 1:** um runtime pequeno carregado nas páginas que usam diretivas.

**Fase 2:** módulos separados por capacidade (forms, modal, table,
navigation).

**Fase 3:** análise estática de templates para incluir somente módulos
necessários.

**Fase 4:** otimização e remoção de código não utilizado, com source
maps para desenvolvimento.

### 20.3 Limite importante

A análise estática pode falhar quando módulos são registrados
dinamicamente ou templates são construídos em runtime. Nesse caso,
exigir registro explícito ou incluir o módulo de forma conservadora. Não
sacrificar confiabilidade para economizar alguns bytes.

------------------------------------------------------------------------

## 21. Comparação com outras abordagens

  -----------------------------------------------------------------------
  Abordagem               Ponto forte             Custo/limitação
  ----------------------- ----------------------- -----------------------
  HTML + Express manual   Controle total e poucas Repetição de
                          abstrações              renderização e
                                                  interações

  Templates server-side   Simplicidade e HTML     Interatividade costuma
  tradicionais            pronto                  exigir código adicional

  HTMX + Alpine           Excelente progressive   Ecossistema e
                          enhancement             convenções separados

  React SPA               Ecossistema e           Mais JavaScript e
                          interfaces complexas    infraestrutura
                                                  client-side

  Next.js                 SSR/SSG e ecossistema   Mais conceitos e
                          React                   convenções

  FLASH                   HTML-first, runtime     Ecossistema próprio,
                          seletivo e integração   risco de escopo e
                                                  manutenção
  -----------------------------------------------------------------------

FLASH deve provar valor por simplicidade de aplicação, desempenho medido
e previsibilidade --- não por slogans.

------------------------------------------------------------------------

## 22. Riscos e decisões arquiteturais

### 22.1 Risco: framework virar uma linguagem enorme

**Mitigação:** limitar diretivas; lógica complexa fica em módulos JS;
não criar diretiva nova sem caso de uso recorrente.

### 22.2 Risco: CRUD mágico e inseguro

**Mitigação:** CRUD é um componente visual/configurável, não um atalho
que pula autorização, validação ou serviços.

### 22.3 Risco: HTML parcial inconsistente

**Mitigação:** contrato de resposta explícito, alvo explícito, testes
E2E e fallback tradicional.

### 22.4 Risco: hidratação complexa

**Mitigação:** não hidratar toda a árvore. Usar progressive enhancement
e módulos locais. Evitar estado universal sincronizado com SSR.

### 22.5 Risco: pouca adoção

**Mitigação:** documentação excelente, exemplos completos, integração
com Express, templates simples e possibilidade de abandonar FLASH sem
reescrever toda a lógica de negócio.

### 22.6 Risco: segurança do parser

**Mitigação:** gramática pequena, AST, sem execução dinâmica, fuzzing e
testes de segurança.

### 22.7 Decisão: não implementar Virtual DOM no MVP

O DOM real é suficiente para o escopo inicial. Atualizações devem ser
direcionadas e medidas. Se benchmarks demonstrarem gargalos, otimizar o
caminho específico antes de introduzir uma camada de reconciliação.

------------------------------------------------------------------------

## 23. Roadmap de desenvolvimento

### Fase 0 --- Prova de conceito

Objetivo: provar o modelo sem construir um framework inteiro.

Entregas: - servidor Express; - uma rota; - template com interpolação; -
escape automático; - lista renderizada no servidor; - teste de XSS; -
medição de HTML e JS.

Critério de saída: uma página dinâmica funciona sem JavaScript no
navegador.

### Fase 1 --- Núcleo SSR

Entregas: - loader de templates; - parser/AST; - interpolação; - `if` e
`each`; - layouts e includes; - componentes simples; - cache de
template; - erros de desenvolvimento.

### Fase 2 --- Runtime mínimo

Entregas: - delegação de eventos; - `f-show`; - `f-model`; - `f-bind`; -
registro de ações; - limpeza de elementos removidos.

### Fase 3 --- Formulários e HTML parcial

Entregas: - formulários tradicionais; - aprimoramento AJAX opt-in; -
CSRF; - alvo de atualização; - respostas parciais; - loading e
tratamento de erros.

### Fase 4 --- Componentes administrativos

Entregas: - modal acessível; - toast; - tabela; - paginação; - campos de
formulário; - empty state.

### Fase 5 --- Build e otimização

Entregas: - manifesto; - módulos por capacidade; - code splitting; -
assets com hash; - análise de uso; - benchmarks.

### Fase 6 --- Estabilização

Entregas: - documentação; - exemplos; - guias de migração; - política de
versões; - testes de compatibilidade; - auditoria de segurança; -
release candidata.

------------------------------------------------------------------------

## 24. Escopo do MVP --- o que entra e o que fica de fora

### Entra

-   Node.js ES Modules;
-   integração Express;
-   SSR;
-   templates com interpolação escapada;
-   `if` e `each` no servidor;
-   layouts e includes;
-   componentes server-side simples;
-   runtime opcional;
-   delegação de eventos;
-   formulário HTML padrão;
-   aprimoramento AJAX opt-in;
-   atualização de uma região;
-   CSRF integrado ao adapter;
-   testes unitários e E2E básicos.

### Não entra inicialmente

-   Virtual DOM;
-   hydration universal;
-   SSR streaming;
-   compilador complexo;
-   linguagem de expressões completa;
-   estado global reativo;
-   router client-side obrigatório;
-   CRUD automático com acesso ao banco;
-   ORM próprio;
-   sistema de autenticação próprio;
-   sistema de CSS;
-   editor visual;
-   plugin marketplace;
-   suporte a múltiplos runtimes.

------------------------------------------------------------------------

## 25. Exemplo completo de uma tela

### Rota

``` js
flash.get('/clients', async (ctx) => {
  const clients = await clientService.list({
    search: ctx.query.q ?? '',
    page: Number(ctx.query.page ?? 1)
  });

  return ctx.render('clients/index', {
    title: 'Clientes',
    clients,
    search: ctx.query.q ?? ''
  });
});
```

### Template

``` html
{{> layouts/app title=title}}

{{#content "body"}}
  <main>
    <header>
      <h1>{{ title }}</h1>
      <a href="/clients/new" class="button">Novo cliente</a>
    </header>

    <form method="GET"
          action="/clients"
          f-submit="ajax"
          f-target="#results">
      <label for="q">Pesquisar</label>
      <input id="q" name="q" value="{{ search }}">
      <button type="submit">Buscar</button>
    </form>

    <section id="results">
      {{> clients/list clients=clients}}
    </section>
  </main>
{{/content}}
```

### Fragmento da lista

``` html
<table>
  <thead>
    <tr>
      <th>Nome</th>
      <th>E-mail</th>
      <th>Ações</th>
    </tr>
  </thead>
  <tbody>
    {{#each clients.items as client}}
      <tr>
        <td>{{ client.name }}</td>
        <td>{{ client.email }}</td>
        <td>
          <a href="/clients/{{ client.id }}/edit">Editar</a>
          <form method="POST" action="/clients/{{ client.id }}/delete">
            <input type="hidden" name="_csrf" value="{{ csrfToken }}">
            <button type="submit"
                    f-confirm="Deseja excluir este cliente?">
              Excluir
            </button>
          </form>
        </td>
      </tr>
    {{else}}
      <tr>
        <td colspan="3">Nenhum cliente encontrado.</td>
      </tr>
    {{/each}}
  </tbody>
</table>
```

### Observações

-   A sintaxe de fragmento e `else` precisa ser implementada e testada.
-   O exemplo de exclusão usa formulário POST para compatibilidade HTML;
    o servidor valida CSRF e autorização.
-   O `client.id` deve ser tratado como dado não confiável na rota e
    validado no servidor.
-   O template não consulta banco nem decide permissões.
-   O HTML inicial é completo; o AJAX é melhoria opcional.

------------------------------------------------------------------------

## 26. Convenções de qualidade

1.  JavaScript em ES Modules.
2.  Código sem estado global compartilhado entre requisições.
3.  Funções pequenas e responsabilidade única.
4.  Controllers finos.
5.  Regras de negócio em services.
6.  Persistência em repositories/adapters.
7.  Templates sem lógica de negócio.
8.  Escape automático por padrão.
9.  Testes para cada diretiva e contexto de escape.
10. Sem dependência obrigatória de bundler no runtime básico.
11. Dependências pequenas e justificadas.
12. Documentar comportamento e limitações, não apenas APIs.

### 26.1 Compatibilidade

Definir uma matriz oficial de navegadores suportados antes do primeiro
release estável. Usar recursos nativos amplamente disponíveis ou
fornecer fallback. Não prometer suporte universal sem testes.

### 26.2 Versionamento

Adotar SemVer após a API pública estabilizar: - `0.x`: API
experimental; - `1.0`: contratos públicos testados e documentados; -
major: mudanças incompatíveis; - minor: recursos compatíveis; - patch:
correções compatíveis.

------------------------------------------------------------------------

## 27. Critérios para considerar FLASH bem-sucedido

FLASH só deve ser considerado bem-sucedido se demonstrar, em aplicações
reais:

-   menos código repetitivo na aplicação;
-   menor ou comparável quantidade de JavaScript transferido em páginas
    equivalentes;
-   HTML funcional antes do JavaScript;
-   boa experiência em redes lentas;
-   segurança auditável;
-   facilidade de depuração;
-   testes simples;
-   ausência de acoplamento excessivo entre view e banco;
-   possibilidade de escrever JavaScript convencional quando necessário;
-   manutenção viável por uma equipe pequena.

A métrica principal não é o tamanho do framework. É o custo total de
construir, testar, operar e manter a aplicação.

------------------------------------------------------------------------

## 28. Decisões ainda abertas

Estas decisões devem ser resolvidas com protótipos, não por preferência:

1.  Parser próprio de templates ou adoção/adaptação de engine existente?
2.  Sintaxe final de blocos: `{{#if}}`/`{{#each}}` ou tags HTML
    declarativas?
3.  Resposta parcial por `Content-Type` próprio, header ou convenção de
    fragmento?
4.  Integração nativa com Express ou adapter independente desde o
    início?
5.  Estado client-side mínimo com Proxy ou ações explícitas sem
    reatividade automática?
6.  Como registrar módulos de componentes no build?
7.  Qual estratégia de CSS e design tokens (provavelmente externa ao
    núcleo)?
8.  Como garantir compatibilidade com CSP estrita?

Cada decisão deve ser acompanhada de um pequeno protótipo e testes.

------------------------------------------------------------------------

## 29. Definição final do produto

**FLASH é um framework HTML-first para aplicações orientadas a dados.**
O servidor entrega HTML pronto, seguro e semântico. O navegador recebe
apenas o JavaScript necessário para aprimorar interações. A lógica de
negócio permanece no servidor, enquanto templates, componentes e
convenções reduzem a quantidade de código repetitivo.

### Proposta de valor

> Construa sistemas completos escrevendo HTML e JavaScript simples.
> FLASH cuida da renderização, dos formulários e das atualizações de
> interface --- sem obrigar sua aplicação a virar uma SPA.

### Regra de ouro

> **Se uma abstração não reduzir a complexidade total da aplicação, ela
> não deve entrar no FLASH.**

------------------------------------------------------------------------

## 30. Referências técnicas para implementação

A implementação deve consultar as especificações oficiais e manter
compatibilidade com elas:

-   HTML Living Standard: https://html.spec.whatwg.org/
-   DOM Standard: https://dom.spec.whatwg.org/
-   Fetch Standard: https://fetch.spec.whatwg.org/
-   ECMAScript: https://tc39.es/ecma262/
-   HTTP Semantics (RFC 9110): https://www.rfc-editor.org/rfc/rfc9110
-   Content Security Policy: https://www.w3.org/TR/CSP3/
-   WCAG 2.2: https://www.w3.org/TR/WCAG22/
-   Node.js: https://nodejs.org/docs/latest/api/
-   Express: https://expressjs.com/

Estas referências são fontes de implementação. FLASH não deve redefinir
o comportamento de HTML, DOM, HTTP ou JavaScript sem necessidade.

------------------------------------------------------------------------

**Fim da especificação FLASH 0.1.**
